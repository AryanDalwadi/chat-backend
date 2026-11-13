import type { Request, Response } from "express";
import { z } from "zod";
import type { AuthedRequest } from "../middlewares/auth.middleware.js";
import { HttpError } from "../middlewares/error.middleware.js";
import {
  editMessage as editChatMessage,
  findUserIdByEmail,
  listChatMessages,
  markMessageRead as markChatMessageRead,
  sendMessage as sendChatMessage,
  updateLastSeen as updateChatLastSeen,
} from "../services/message.service.js";
import {
  editMessageBodySchema,
  editMessageParamsSchema,
} from "../validation/message.validation.js";

const sendMessageBodySchema = z.object({
  senderId: z.uuid(),
  text: z.string(),
});

const markMessageReadBodySchema = z.object({
  userId: z.uuid(),
});

const updateLastSeenBodySchema = z.object({
  userId: z.uuid(),
  messageId: z.string(),
});

const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 100;

function readParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readQuery(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }

  return undefined;
}

function parseLimit(value: unknown): number | undefined {
  if (value === undefined) {
    return DEFAULT_MESSAGE_LIMIT;
  }

  const raw = readQuery(value);
  if (!raw || !/^[1-9]\d*$/.test(raw)) {
    return undefined;
  }

  const limit = Number(raw);
  if (limit > MAX_MESSAGE_LIMIT) {
    return undefined;
  }

  return limit;
}

function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ success: false, message });
}

export async function sendMessage(req: Request, res: Response): Promise<void> {
  const chatId = readParam(req.params.chatId);
  if (!chatId || !z.uuid().safeParse(chatId).success) {
    fail(res, 400, "chatId must be a UUID");
    return;
  }

  const parsed = sendMessageBodySchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "senderId must be a UUID and text is required");
    return;
  }

  const text = parsed.data.text.trim();
  if (!text) {
    fail(res, 400, "Message text is required");
    return;
  }

  try {
    const sent = await sendChatMessage({
      chatId,
      senderId: parsed.data.senderId,
      text,
    });

    res.status(201).json({
      success: true,
      message: "Message sent successfully",
      data: { messageId: sent.messageId },
    });
  } catch (error) {
    if (error instanceof HttpError) {
      fail(res, error.status, error.message);
      return;
    }

    throw error;
  }
}

export async function editMessage(req: AuthedRequest, res: Response): Promise<void> {
  const email = req.userEmail;
  if (!email) {
    fail(res, 401, "Unauthorized");
    return;
  }

  const params = editMessageParamsSchema.safeParse({
    chatId: readParam(req.params.chatId),
    messageId: readParam(req.params.messageId),
  });
  if (!params.success) {
    fail(res, 400, params.error.issues[0]?.message ?? "Invalid message request");
    return;
  }

  const body = editMessageBodySchema.safeParse(req.body);
  if (!body.success) {
    fail(res, 400, body.error.issues[0]?.message ?? "Invalid message text");
    return;
  }

  try {
    const userId = await findUserIdByEmail(email);
    const updated = await editChatMessage({
      chatId: params.data.chatId,
      messageId: params.data.messageId,
      userId,
      text: body.data.text,
    });

    res.status(200).json({
      success: true,
      message: "Message updated successfully",
      data: updated,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      fail(res, error.status, error.message);
      return;
    }

    throw error;
  }
}

export async function getMessages(req: AuthedRequest, res: Response): Promise<void> {
  const chatId = readParam(req.params.chatId);
  if (!chatId || !z.uuid().safeParse(chatId).success) {
    fail(res, 400, "chatId must be a UUID");
    return;
  }

  const email = req.userEmail;
  if (!email) {
    fail(res, 401, "Unauthorized");
    return;
  }

  const limit = parseLimit(req.query.limit);
  if (limit === undefined) {
    fail(res, 400, "limit must be a positive integer up to 100");
    return;
  }

  const cursor = readQuery(req.query.cursor);

  try {
    const userId = await findUserIdByEmail(email);
    const result = await listChatMessages({
      chatId,
      userId,
      limit,
      ...(cursor ? { cursor } : {}),
    });

    res.status(200).json({
      success: true,
      data: result.messages,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      fail(res, error.status, error.message);
      return;
    }

    throw error;
  }
}

export async function markMessageRead(req: AuthedRequest, res: Response): Promise<void> {
  const chatId = readParam(req.params.chatId);
  const messageId = readParam(req.params.messageId);

  if (!chatId || !z.uuid().safeParse(chatId).success) {
    fail(res, 400, "chatId must be a UUID");
    return;
  }

  if (!messageId || messageId.includes("/") || messageId.length > 128) {
    fail(res, 400, "messageId is invalid");
    return;
  }

  const email = req.userEmail;
  if (!email) {
    fail(res, 401, "Unauthorized");
    return;
  }

  const parsed = markMessageReadBodySchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "userId must be a UUID");
    return;
  }

  try {
    const userId = await findUserIdByEmail(email);
    if (parsed.data.userId.toLowerCase() !== userId.toLowerCase()) {
      fail(res, 403, "userId does not match the authenticated user");
      return;
    }

    await markChatMessageRead({ chatId, messageId, userId });
    res.status(200).json({
      success: true,
      message: "Message marked as read",
    });
  } catch (error) {
    if (error instanceof HttpError) {
      fail(res, error.status, error.message);
      return;
    }

    throw error;
  }
}

export async function updateLastSeen(req: AuthedRequest, res: Response): Promise<void> {
  const chatId = readParam(req.params.chatId);
  if (!chatId || !z.uuid().safeParse(chatId).success) {
    fail(res, 400, "chatId must be a UUID");
    return;
  }

  const email = req.userEmail;
  if (!email) {
    fail(res, 401, "Unauthorized");
    return;
  }

  const parsed = updateLastSeenBodySchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "userId must be a UUID and messageId is required");
    return;
  }

  const messageId = parsed.data.messageId.trim();
  if (!messageId || messageId.includes("/") || messageId.length > 128) {
    fail(res, 400, "messageId is invalid");
    return;
  }

  try {
    const userId = await findUserIdByEmail(email);
    if (parsed.data.userId.toLowerCase() !== userId.toLowerCase()) {
      fail(res, 403, "userId does not match the authenticated user");
      return;
    }

    await updateChatLastSeen({ chatId, userId, messageId });
    res.status(200).json({
      success: true,
      message: "Last seen updated successfully",
    });
  } catch (error) {
    if (error instanceof HttpError) {
      fail(res, error.status, error.message);
      return;
    }

    throw error;
  }
}
