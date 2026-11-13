import type { Request, Response } from "express";
import { z } from "zod";
import type { AuthedRequest } from "../middlewares/auth.middleware.js";
import { HttpError } from "../middlewares/error.middleware.js";
import * as chatService from "../services/chat.service.js";
import * as messageService from "../services/message.service.js";
import { createChatBodySchema, createMessageBodySchema } from "../types/chat.types.js";
import {
  addGroupMembersBodySchema,
  createGroupChatBodySchema,
  removeGroupMemberParamsSchema,
} from "../validation/chat.validation.js";

const createOrGetChatBodySchema = z.object({
  userAId: z.uuid(),
  userBId: z.uuid(),
});

function readParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requireUserId(req: AuthedRequest, res: Response): string | undefined {
  if (!req.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return undefined;
  }

  return req.userId;
}

export async function createOrGetChat(req: Request, res: Response): Promise<void> {
  const parsed = createOrGetChatBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "userAId and userBId must be valid UUIDs",
    });
    return;
  }

  if (parsed.data.userAId.toLowerCase() === parsed.data.userBId.toLowerCase()) {
    res.status(400).json({
      success: false,
      message: "Users cannot create a chat with themselves",
    });
    return;
  }

  try {
    const chat = await chatService.createOrGetChat(parsed.data);
    res.status(200).json({
      success: true,
      chatId: chat.chatId,
      message: "Chat retrieved successfully",
    });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ success: false, message: error.message });
      return;
    }

    throw error;
  }
}

export async function createGroupChat(req: AuthedRequest, res: Response): Promise<void> {
  const email = req.userEmail;
  if (!email) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  const parsed = createGroupChatBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: parsed.error.issues[0]?.message ?? "Invalid group chat request",
    });
    return;
  }

  try {
    const creatorId = await messageService.findUserIdByEmail(email);
    if (parsed.data.createdBy.toLowerCase() !== creatorId.toLowerCase()) {
      res.status(403).json({
        success: false,
        message: "createdBy does not match the authenticated user",
      });
      return;
    }

    const group = await chatService.createGroupChat({
      groupName: parsed.data.groupName,
      createdBy: creatorId,
      memberIds: parsed.data.memberIds,
    });

    res.status(201).json({
      success: true,
      message: "Group created successfully",
      data: group,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ success: false, message: error.message });
      return;
    }

    throw error;
  }
}

export async function addGroupMembers(req: AuthedRequest, res: Response): Promise<void> {
  const email = req.userEmail;
  if (!email) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  const chatId = readParam(req.params.chatId);
  if (!chatId || !z.uuid().safeParse(chatId).success) {
    res.status(400).json({ success: false, message: "chatId must be a UUID" });
    return;
  }

  const parsed = addGroupMembersBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: parsed.error.issues[0]?.message ?? "Invalid member request",
    });
    return;
  }

  try {
    const requesterId = await messageService.findUserIdByEmail(email);
    const result = await chatService.addGroupMembers({
      chatId,
      requesterId,
      memberIds: parsed.data.memberIds,
    });

    res.status(200).json({
      success: true,
      message: "Members added successfully",
      data: result,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ success: false, message: error.message });
      return;
    }

    throw error;
  }
}

export async function removeGroupMember(req: AuthedRequest, res: Response): Promise<void> {
  const email = req.userEmail;
  if (!email) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  const parsed = removeGroupMemberParamsSchema.safeParse({
    chatId: readParam(req.params.chatId),
    memberId: readParam(req.params.memberId),
  });
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: parsed.error.issues[0]?.message ?? "chatId and memberId must be UUIDs",
    });
    return;
  }

  try {
    const requesterId = await messageService.findUserIdByEmail(email);
    const result = await chatService.removeGroupMember({
      chatId: parsed.data.chatId,
      memberId: parsed.data.memberId,
      requesterId,
    });

    res.status(200).json({
      success: true,
      message: "Member removed successfully",
      data: result,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ success: false, message: error.message });
      return;
    }

    throw error;
  }
}

export async function listUserChats(req: Request, res: Response): Promise<void> {
  const userId = readParam(req.params.userId);
  if (!userId || !z.uuid().safeParse(userId).success) {
    res.status(400).json({ success: false, message: "userId must be a UUID" });
    return;
  }

  try {
    const chats = await chatService.listUserChats(userId);
    res.status(200).json({ success: true, data: chats });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ success: false, message: error.message });
      return;
    }

    throw error;
  }
}

export async function createChat(req: AuthedRequest, res: Response): Promise<void> {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const parsed = createChatBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  const participantIds = Array.from(new Set([userId, ...parsed.data.participantIds]));
  const chat = await chatService.createChat(participantIds);
  res.status(201).json(chat);
}

export async function listChats(req: AuthedRequest, res: Response): Promise<void> {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const chats = await chatService.listChats(userId);
  res.json(chats);
}

export async function listMessages(req: AuthedRequest, res: Response): Promise<void> {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const chatId = readParam(req.params.chatId);
  if (!chatId) {
    res.status(400).json({ error: "Missing chat id" });
    return;
  }

  const messages = await messageService.listMessages(chatId, userId);
  res.json(messages);
}

export async function createMessage(req: AuthedRequest, res: Response): Promise<void> {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const chatId = readParam(req.params.chatId);
  if (!chatId) {
    res.status(400).json({ error: "Missing chat id" });
    return;
  }

  const parsed = createMessageBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  const message = await messageService.createMessage(chatId, userId, parsed.data.body);
  res.status(201).json(message);
}
