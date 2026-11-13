import { FieldPath, type Timestamp } from "firebase-admin/firestore";
import { pool } from "../config/db.js";
import { FieldValue, firestore } from "../config/firebase.js";
import { HttpError } from "../middlewares/error.middleware.js";
import type { Message } from "../types/chat.types.js";
import { MAX_MESSAGE_LENGTH } from "../validation/message.validation.js";

export interface SendMessageInput {
  chatId: string;
  senderId: string;
  text: string;
}

export interface SentMessage {
  messageId: string;
}

export interface ListChatMessagesInput {
  chatId: string;
  userId: string;
  limit: number;
  cursor?: string;
}

export interface ListedChatMessage {
  messageId: string;
  senderId: string;
  text: string;
  createdAt: string | null;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface ListChatMessagesResult {
  messages: ListedChatMessage[];
  nextCursor: string | null;
}

export interface MarkMessageReadInput {
  chatId: string;
  messageId: string;
  userId: string;
}

export interface UpdateLastSeenInput {
  chatId: string;
  userId: string;
  messageId: string;
}

type ChatMembersRow = {
  user1_id: string | null;
  user2_id: string | null;
  chat_type: string;
};

type MessageRow = {
  id: string;
  chat_id: string;
  sender_id: string;
  body: string;
  created_at: Date;
};

async function assertParticipant(chatId: string, userId: string): Promise<void> {
  const result = await pool.query(
    "SELECT 1 FROM chat_participants WHERE chat_id = $1 AND user_id = $2",
    [chatId, userId],
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new HttpError(404, "Chat not found");
  }
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    chatId: row.chat_id,
    senderId: row.sender_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

export async function listMessages(chatId: string, userId: string): Promise<Message[]> {
  await assertParticipant(chatId, userId);

  const result = await pool.query<MessageRow>(
    `SELECT id, chat_id, sender_id, body, created_at
     FROM messages
     WHERE chat_id = $1
     ORDER BY created_at ASC`,
    [chatId],
  );

  return result.rows.map(toMessage);
}

export async function createMessage(
  chatId: string,
  senderId: string,
  body: string,
): Promise<Message> {
  await assertParticipant(chatId, senderId);

  const result = await pool.query<MessageRow>(
    `INSERT INTO messages (chat_id, sender_id, body)
     VALUES ($1, $2, $3)
     RETURNING id, chat_id, sender_id, body, created_at`,
    [chatId, senderId, body],
  );
  const row = result.rows[0];

  if (!row) {
    throw new Error("Failed to create message");
  }

  return toMessage(row);
}

export async function findUserIdByEmail(email: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE lower(email) = lower($1)",
    [email],
  );
  const user = result.rows[0];

  if (!user) {
    throw new HttpError(404, "User not found");
  }

  return user.id;
}

async function assertChatMember(chatId: string, userId: string): Promise<void> {
  const chatResult = await pool.query<ChatMembersRow>(
    "SELECT user1_id, user2_id, chat_type FROM chats WHERE id = $1",
    [chatId],
  );
  const chat = chatResult.rows[0];

  if (!chat) {
    throw new HttpError(404, "Chat not found");
  }

  if (chat.chat_type === "group") {
    const membership = await pool.query(
      "SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2",
      [chatId, userId],
    );

    if ((membership.rowCount ?? 0) === 0) {
      throw new HttpError(403, "You are not a member of this chat");
    }

    return;
  }

  const normalizedUserId = userId.toLowerCase();
  const isMember =
    chat.user1_id?.toLowerCase() === normalizedUserId ||
    chat.user2_id?.toLowerCase() === normalizedUserId;

  if (!isMember) {
    throw new HttpError(403, "You are not a member of this chat");
  }
}

function messageTimeMillis(value: unknown): number | null {
  if (typeof value === "object" && value !== null && "toMillis" in value) {
    return (value as Timestamp).toMillis();
  }

  return null;
}

function isLaterMessage(
  candidateId: string,
  candidateCreatedAt: unknown,
  currentId: string,
  currentCreatedAt: unknown,
): boolean {
  const candidateTime = messageTimeMillis(candidateCreatedAt);
  const currentTime = messageTimeMillis(currentCreatedAt);

  if (candidateTime !== null && currentTime !== null && candidateTime !== currentTime) {
    return candidateTime > currentTime;
  }

  return candidateId > currentId;
}

function toIsoTimestamp(value: unknown): string | null {
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const timestamp = value as Timestamp;
    return timestamp.toDate().toISOString();
  }

  return null;
}

export async function sendMessage(input: SendMessageInput): Promise<SentMessage> {
  const text = input.text.trim();
  if (!text) {
    throw new HttpError(400, "Message text is required");
  }

  await assertChatMember(input.chatId, input.senderId);

  const messageRef = firestore.collection("chats").doc(input.chatId).collection("messages").doc();

  await messageRef.set({
    senderId: input.senderId,
    text,
    createdAt: FieldValue.serverTimestamp(),
    editedAt: null,
    deletedAt: null,
  });

  return { messageId: messageRef.id };
}

export interface EditMessageInput {
  chatId: string;
  messageId: string;
  userId: string;
  text: string;
}

export interface EditedMessage {
  messageId: string;
  text: string;
  editedAt: string;
}

export async function editMessage(input: EditMessageInput): Promise<EditedMessage> {
  const text = input.text.trim();
  if (!text) {
    throw new HttpError(400, "Message text is required");
  }

  if (text.length > MAX_MESSAGE_LENGTH) {
    throw new HttpError(400, `Message text must be at most ${MAX_MESSAGE_LENGTH} characters`);
  }

  const chatId = input.chatId.toLowerCase();
  const userId = input.userId.toLowerCase();
  await assertChatMember(chatId, userId);

  const messageRef = firestore.collection("chats").doc(chatId).collection("messages").doc(input.messageId);

  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(messageRef);

    if (!snapshot.exists) {
      throw new HttpError(404, "Message not found");
    }

    if (snapshot.get("deletedAt") != null) {
      throw new HttpError(400, "Deleted messages cannot be edited");
    }

    const senderId = snapshot.get("senderId");
    if (typeof senderId !== "string" || senderId.toLowerCase() !== userId) {
      throw new HttpError(403, "Only the original sender can edit this message");
    }

    transaction.update(messageRef, {
      text,
      editedAt: FieldValue.serverTimestamp(),
    });
  });

  const updated = await messageRef.get();
  const editedAt = toIsoTimestamp(updated.get("editedAt"));

  if (!editedAt) {
    throw new HttpError(500, "Failed to update message");
  }

  return {
    messageId: input.messageId,
    text,
    editedAt,
  };
}

export async function listChatMessages(
  input: ListChatMessagesInput,
): Promise<ListChatMessagesResult> {
  await assertChatMember(input.chatId, input.userId);

  const messages = firestore.collection("chats").doc(input.chatId).collection("messages");
  let query = messages
    .orderBy("createdAt", "desc")
    .orderBy(FieldPath.documentId(), "desc")
    .limit(input.limit + 1);

  if (input.cursor) {
    const cursorSnapshot = await messages.doc(input.cursor).get();
    if (!cursorSnapshot.exists) {
      throw new HttpError(400, "Invalid cursor");
    }

    query = query.startAfter(cursorSnapshot);
  }

  const snapshot = await query.get();
  const hasMore = snapshot.docs.length > input.limit;
  const page = hasMore ? snapshot.docs.slice(0, input.limit) : snapshot.docs;
  const oldestInPage = page[page.length - 1];

  return {
    messages: page.reverse().map((doc) => {
      const data = doc.data();
      return {
        messageId: doc.id,
        senderId: typeof data.senderId === "string" ? data.senderId : "",
        text: typeof data.text === "string" ? data.text : "",
        createdAt: toIsoTimestamp(data.createdAt),
        editedAt: toIsoTimestamp(data.editedAt),
        deletedAt: toIsoTimestamp(data.deletedAt),
      };
    }),
    nextCursor: hasMore && oldestInPage ? oldestInPage.id : null,
  };
}

export async function markMessageRead(input: MarkMessageReadInput): Promise<void> {
  await assertChatMember(input.chatId, input.userId);

  const messageRef = firestore
    .collection("chats")
    .doc(input.chatId)
    .collection("messages")
    .doc(input.messageId);
  const messageSnapshot = await messageRef.get();

  if (!messageSnapshot.exists) {
    throw new HttpError(404, "Message not found");
  }

  const receiptRef = messageRef.collection("readReceipts").doc(input.userId);

  await firestore.runTransaction(async (transaction) => {
    const receiptSnapshot = await transaction.get(receiptRef);
    if (receiptSnapshot.exists && receiptSnapshot.get("readAt") != null) {
      return;
    }

    transaction.set(
      receiptRef,
      {
        userId: input.userId,
        readAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
}

export async function updateLastSeen(input: UpdateLastSeenInput): Promise<void> {
  await assertChatMember(input.chatId, input.userId);

  const messages = firestore.collection("chats").doc(input.chatId).collection("messages");
  const messageRef = messages.doc(input.messageId);
  const memberRef = firestore
    .collection("chats")
    .doc(input.chatId)
    .collection("members")
    .doc(input.userId);

  await firestore.runTransaction(async (transaction) => {
    const messageSnapshot = await transaction.get(messageRef);
    if (!messageSnapshot.exists) {
      throw new HttpError(404, "Message not found");
    }

    const memberSnapshot = await transaction.get(memberRef);
    const currentMessageId = memberSnapshot.exists
      ? memberSnapshot.get("lastSeenMessageId")
      : undefined;

    if (currentMessageId === input.messageId) {
      return;
    }

    if (typeof currentMessageId === "string" && currentMessageId.length > 0) {
      const currentSnapshot = await transaction.get(messages.doc(currentMessageId));
      if (
        currentSnapshot.exists &&
        !isLaterMessage(
          input.messageId,
          messageSnapshot.get("createdAt"),
          currentMessageId,
          currentSnapshot.get("createdAt"),
        )
      ) {
        return;
      }
    }

    transaction.set(
      memberRef,
      {
        lastSeenMessageId: input.messageId,
        lastSeenAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
}
