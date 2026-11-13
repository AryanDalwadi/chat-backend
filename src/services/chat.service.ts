import { pool } from "../config/db.js";
import { FieldValue, firestore } from "../config/firebase.js";
import { HttpError } from "../middlewares/error.middleware.js";
import type { Chat } from "../types/chat.types.js";
import { resolveGroupMemberIds } from "../validation/chat.validation.js";

export interface CreateOrGetChatInput {
  userAId: string;
  userBId: string;
}

export interface CreateOrGetChatResult {
  chatId: string;
}

export interface ChatMemberSummary {
  id: string;
  name: string;
}

export interface UserChatSummary {
  chatId: string;
  members: ChatMemberSummary[];
  createdAt: Date;
}

type ChatRow = {
  id: string;
  created_at: Date;
  participant_ids: string[];
};

export async function createChat(participantIds: string[]): Promise<Chat> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const inserted = await client.query<{ id: string; created_at: Date }>(
      "INSERT INTO chats DEFAULT VALUES RETURNING id, created_at",
    );
    const chat = inserted.rows[0];

    if (!chat) {
      throw new Error("Failed to create chat");
    }

    for (const userId of participantIds) {
      await client.query(
        "INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2)",
        [chat.id, userId],
      );
    }

    await client.query("COMMIT");

    return {
      id: chat.id,
      participantIds,
      createdAt: chat.created_at,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listChats(userId: string): Promise<Chat[]> {
  const result = await pool.query<ChatRow>(
    `SELECT c.id, c.created_at, array_agg(p.user_id) AS participant_ids
     FROM chats c
     JOIN chat_participants me ON me.chat_id = c.id AND me.user_id = $1
     JOIN chat_participants p ON p.chat_id = c.id
     GROUP BY c.id, c.created_at
     ORDER BY c.created_at DESC`,
    [userId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    participantIds: row.participant_ids,
    createdAt: row.created_at,
  }));
}

export async function createOrGetChat(input: CreateOrGetChatInput): Promise<CreateOrGetChatResult> {
  const [user1Id, user2Id] = [input.userAId, input.userBId]
    .map((id) => id.toLowerCase())
    .sort((left, right) => (left < right ? -1 : 1));

  if (user1Id === user2Id) {
    throw new HttpError(400, "Users cannot create a chat with themselves");
  }

  const users = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE id = $1 OR id = $2",
    [user1Id, user2Id],
  );

  if (users.rows.length !== 2) {
    throw new HttpError(404, "One or both users do not exist");
  }

  const saved = await pool.query<{ id: string }>(
    `INSERT INTO chats (user1_id, user2_id)
     VALUES ($1, $2)
     ON CONFLICT (user1_id, user2_id)
     DO UPDATE SET created_at = chats.created_at
     RETURNING id`,
    [user1Id, user2Id],
  );
  const chat = saved.rows[0];

  if (!chat) {
    throw new HttpError(500, "Failed to create chat");
  }

  return { chatId: chat.id };
}

export async function listUserChats(userId: string): Promise<UserChatSummary[]> {
  const user = await pool.query(
    "SELECT id FROM users WHERE id = $1",
    [userId],
  );

  if ((user.rowCount ?? 0) === 0) {
    throw new HttpError(404, "User not found");
  }

  const result = await pool.query<{
    chat_id: string;
    created_at: Date;
    members: ChatMemberSummary[];
  }>(
    `SELECT chat_id, created_at, members
     FROM (
       SELECT
         c.id AS chat_id,
         c.created_at,
         json_agg(
           json_build_object('id', u.id, 'name', u.name)
           ORDER BY CASE WHEN u.id = c.user1_id THEN 0 ELSE 1 END
         ) AS members
       FROM chats c
       JOIN users u ON u.id = c.user1_id OR u.id = c.user2_id
       WHERE c.chat_type = 'direct'
         AND (c.user1_id = $1 OR c.user2_id = $1)
       GROUP BY c.id, c.created_at

       UNION ALL

       SELECT
         c.id AS chat_id,
         c.created_at,
         json_agg(
           json_build_object('id', u.id, 'name', u.name)
           ORDER BY CASE WHEN cm.role = 'admin' THEN 0 ELSE 1 END, u.name
         ) AS members
       FROM chats c
       JOIN chat_members mine ON mine.chat_id = c.id AND mine.user_id = $1
       JOIN chat_members cm ON cm.chat_id = c.id
       JOIN users u ON u.id = cm.user_id
       WHERE c.chat_type = 'group'
       GROUP BY c.id, c.created_at
     ) AS user_chats
     ORDER BY created_at DESC`,
    [userId],
  );

  return result.rows.map((row) => ({
    chatId: row.chat_id,
    members: row.members,
    createdAt: row.created_at,
  }));
}

export interface CreateGroupChatInput {
  groupName: string;
  createdBy: string;
  memberIds: string[];
}

export interface CreateGroupChatResult {
  chatId: string;
  groupName: string;
  members: string[];
}

export async function createGroupChat(input: CreateGroupChatInput): Promise<CreateGroupChatResult> {
  const groupName = input.groupName.trim();
  const createdBy = input.createdBy.toLowerCase();
  const members = resolveGroupMemberIds(createdBy, input.memberIds);

  if (members.length < 2) {
    throw new HttpError(400, "A group must have at least two members");
  }

  const client = await pool.connect();
  let chatId: string;

  try {
    await client.query("BEGIN");

    const existingUsers = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE id = ANY($1::uuid[])",
      [members],
    );

    if (existingUsers.rows.length !== members.length) {
      throw new HttpError(404, "One or more users do not exist");
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO chats (chat_type, group_name, created_by)
       VALUES ('group', $1, $2)
       RETURNING id`,
      [groupName, createdBy],
    );
    const chat = inserted.rows[0];

    if (!chat) {
      throw new HttpError(500, "Failed to create group chat");
    }

    chatId = chat.id;

    await client.query(
      `INSERT INTO chat_members (chat_id, user_id, role)
       SELECT $1, member_id, CASE WHEN member_id = $2::uuid THEN 'admin' ELSE 'member' END
       FROM unnest($3::uuid[]) AS member_id`,
      [chatId, createdBy, members],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  try {
    await writeGroupChatDocuments(chatId, groupName, createdBy, members);
  } catch (error) {
    await pool.query("DELETE FROM chats WHERE id = $1", [chatId]);
    console.error("Failed to create Firestore group documents:", error);
    throw new HttpError(500, "Failed to create group chat");
  }

  return {
    chatId,
    groupName,
    members,
  };
}

export interface AddGroupMembersInput {
  chatId: string;
  requesterId: string;
  memberIds: string[];
}

export interface AddGroupMembersResult {
  chatId: string;
  addedMembers: string[];
}

export async function addGroupMembers(input: AddGroupMembersInput): Promise<AddGroupMembersResult> {
  const chatId = input.chatId.toLowerCase();
  const requesterId = input.requesterId.toLowerCase();
  const memberIds = uniqueMemberIds(input.memberIds);
  const client = await pool.connect();
  let addedMembers: string[] = [];

  try {
    await client.query("BEGIN");

    const chatResult = await client.query<{ id: string; chat_type: string }>(
      "SELECT id, chat_type FROM chats WHERE id = $1 FOR UPDATE",
      [chatId],
    );
    const chat = chatResult.rows[0];

    if (!chat) {
      throw new HttpError(404, "Chat not found");
    }

    if (chat.chat_type !== "group") {
      throw new HttpError(400, "This chat is not a group");
    }

    const requesterResult = await client.query<{ role: string }>(
      "SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2",
      [chat.id, requesterId],
    );
    const requester = requesterResult.rows[0];

    if (!requester || requester.role !== "admin") {
      throw new HttpError(403, "Only group admins can add members");
    }

    const existingUsers = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE id = ANY($1::uuid[])",
      [memberIds],
    );

    if (existingUsers.rows.length !== memberIds.length) {
      throw new HttpError(404, "One or more users do not exist");
    }

    const inserted = await client.query<{ user_id: string }>(
      `INSERT INTO chat_members (chat_id, user_id, role)
       SELECT $1, member_id, 'member'
       FROM unnest($2::uuid[]) AS member_id
       ON CONFLICT (chat_id, user_id) DO NOTHING
       RETURNING user_id`,
      [chat.id, memberIds],
    );
    const insertedIds = new Set(inserted.rows.map((row) => row.user_id.toLowerCase()));
    addedMembers = memberIds.filter((memberId) => insertedIds.has(memberId));

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (addedMembers.length > 0) {
    try {
      await writeAddedMemberDocuments(chatId, addedMembers);
    } catch (error) {
      await pool.query(
        "DELETE FROM chat_members WHERE chat_id = $1 AND user_id = ANY($2::uuid[])",
        [chatId, addedMembers],
      );
      console.error("Failed to create Firestore member documents:", error);
      throw new HttpError(500, "Failed to add members");
    }
  }

  return {
    chatId,
    addedMembers,
  };
}

export interface RemoveGroupMemberInput {
  chatId: string;
  memberId: string;
  requesterId: string;
}

export interface RemoveGroupMemberResult {
  chatId: string;
  members: string[];
}

type RemovedMembership = {
  userId: string;
  role: string;
  joinedAt: Date;
};

type OwnershipTransfer = {
  previousCreatedBy: string;
  newOwnerId: string;
  previousRole: string;
};

type MemberRemoval = {
  chatId: string;
  members: string[];
  removed: RemovedMembership;
  transfer: OwnershipTransfer | null;
};

export async function removeGroupMember(
  input: RemoveGroupMemberInput,
): Promise<RemoveGroupMemberResult> {
  const chatId = input.chatId.toLowerCase();
  const memberId = input.memberId.toLowerCase();
  const requesterId = input.requesterId.toLowerCase();
  const client = await pool.connect();
  let removal: MemberRemoval;

  try {
    await client.query("BEGIN");

    const chatResult = await client.query<{
      id: string;
      chat_type: string;
      created_by: string | null;
    }>(
      "SELECT id, chat_type, created_by FROM chats WHERE id = $1 FOR UPDATE",
      [chatId],
    );
    const chat = chatResult.rows[0];

    if (!chat) {
      throw new HttpError(404, "Chat not found");
    }

    if (chat.chat_type !== "group") {
      throw new HttpError(400, "This chat is not a group");
    }

    const requesterResult = await client.query<{ role: string }>(
      "SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2",
      [chat.id, requesterId],
    );
    const requester = requesterResult.rows[0];

    if (!requester || requester.role !== "admin") {
      throw new HttpError(403, "Only group admins can remove members");
    }

    const memberResult = await client.query<{
      user_id: string;
      role: string;
      joined_at: Date;
    }>(
      `SELECT user_id, role, joined_at
       FROM chat_members
       WHERE chat_id = $1 AND user_id = $2
       FOR UPDATE`,
      [chat.id, memberId],
    );
    const member = memberResult.rows[0];

    if (!member) {
      throw new HttpError(404, "Member not found");
    }

    const countResult = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM chat_members WHERE chat_id = $1",
      [chat.id],
    );
    const memberCount = countResult.rows[0]?.count ?? 0;

    if (memberCount < 2) {
      throw new HttpError(400, "The last member cannot be removed");
    }

    let transfer: OwnershipTransfer | null = null;
    const createdBy = chat.created_by?.toLowerCase() ?? null;

    if (createdBy === member.user_id.toLowerCase()) {
      const successorResult = await client.query<{ user_id: string; role: string }>(
        `SELECT user_id, role
         FROM chat_members
         WHERE chat_id = $1 AND user_id <> $2
         ORDER BY joined_at ASC, user_id ASC
         LIMIT 1
         FOR UPDATE`,
        [chat.id, member.user_id],
      );
      const successor = successorResult.rows[0];

      if (!successor) {
        throw new HttpError(400, "The last member cannot be removed");
      }

      await client.query(
        "UPDATE chat_members SET role = 'admin' WHERE chat_id = $1 AND user_id = $2",
        [chat.id, successor.user_id],
      );
      await client.query(
        "UPDATE chats SET created_by = $2 WHERE id = $1",
        [chat.id, successor.user_id],
      );

      transfer = {
        previousCreatedBy: createdBy,
        newOwnerId: successor.user_id.toLowerCase(),
        previousRole: successor.role,
      };
    }

    await client.query(
      "DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2",
      [chat.id, member.user_id],
    );

    const remaining = await client.query<{ user_id: string }>(
      `SELECT user_id
       FROM chat_members
       WHERE chat_id = $1
       ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, joined_at ASC, user_id ASC`,
      [chat.id],
    );

    removal = {
      chatId: chat.id,
      members: remaining.rows.map((row) => row.user_id),
      removed: {
        userId: member.user_id.toLowerCase(),
        role: member.role,
        joinedAt: member.joined_at,
      },
      transfer,
    };

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  try {
    await deleteRemovedMemberDocument(removal);
  } catch (error) {
    await restoreRemovedMember(removal);
    console.error("Failed to update Firestore membership:", error);
    throw new HttpError(500, "Failed to remove member");
  }

  return {
    chatId: removal.chatId,
    members: removal.members,
  };
}

async function deleteRemovedMemberDocument(removal: MemberRemoval): Promise<void> {
  const batch = firestore.batch();
  const members = firestore.collection("chats").doc(removal.chatId).collection("members");

  batch.delete(members.doc(removal.removed.userId));

  if (removal.transfer) {
    batch.set(
      members.doc(removal.transfer.newOwnerId),
      { role: "admin" },
      { merge: true },
    );
  }

  await batch.commit();
}

async function restoreRemovedMember(removal: MemberRemoval): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (removal.transfer) {
      await client.query(
        "UPDATE chats SET created_by = $2 WHERE id = $1",
        [removal.chatId, removal.transfer.previousCreatedBy],
      );
      await client.query(
        "UPDATE chat_members SET role = $3 WHERE chat_id = $1 AND user_id = $2",
        [removal.chatId, removal.transfer.newOwnerId, removal.transfer.previousRole],
      );
    }

    await client.query(
      `INSERT INTO chat_members (chat_id, user_id, role, joined_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (chat_id, user_id) DO NOTHING`,
      [removal.chatId, removal.removed.userId, removal.removed.role, removal.removed.joinedAt],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Failed to restore removed member:", error);
  } finally {
    client.release();
  }
}

function uniqueMemberIds(memberIds: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const memberId of memberIds) {
    const key = memberId.toLowerCase();
    if (seen.has(key)) {
      throw new HttpError(400, "Duplicate member IDs are not allowed");
    }

    seen.add(key);
    unique.push(key);
  }

  if (unique.length === 0) {
    throw new HttpError(400, "memberIds must include at least one member");
  }

  return unique;
}

async function writeGroupChatDocuments(
  chatId: string,
  groupName: string,
  createdBy: string,
  members: string[],
): Promise<void> {
  const batch = firestore.batch();
  const chatRef = firestore.collection("chats").doc(chatId);

  batch.set(chatRef, {
    chatType: "group",
    groupName,
    createdBy,
    createdAt: FieldValue.serverTimestamp(),
  });

  for (const memberId of members) {
    batch.set(chatRef.collection("members").doc(memberId), {
      userId: memberId,
      role: memberId === createdBy ? "admin" : "member",
      joinedAt: FieldValue.serverTimestamp(),
      lastSeenMessageId: null,
      lastSeenAt: null,
    });
  }

  await batch.commit();
}

async function writeAddedMemberDocuments(chatId: string, memberIds: string[]): Promise<void> {
  const batch = firestore.batch();
  const members = firestore.collection("chats").doc(chatId).collection("members");

  for (const memberId of memberIds) {
    batch.set(members.doc(memberId), {
      userId: memberId,
      role: "member",
      joinedAt: FieldValue.serverTimestamp(),
      lastSeenMessageId: null,
      lastSeenAt: null,
    });
  }

  await batch.commit();
}
