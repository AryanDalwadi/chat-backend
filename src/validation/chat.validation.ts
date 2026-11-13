import { z } from "zod";

export const createGroupChatBodySchema = z
  .object({
    groupName: z
      .string("groupName is required")
      .trim()
      .min(1, "groupName is required")
      .max(100, "groupName must be at most 100 characters"),
    createdBy: z.uuid("createdBy must be a UUID"),
    memberIds: z
      .array(z.uuid("memberIds must be UUIDs"), "memberIds must be an array of UUIDs")
      .min(1, "memberIds must include at least one member")
      .max(100, "A group can have at most 100 members"),
  })
  .superRefine((value, ctx) => {
    const memberIds = new Set<string>();

    for (const memberId of value.memberIds) {
      const key = memberId.toLowerCase();
      if (memberIds.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: "Duplicate member IDs are not allowed",
          path: ["memberIds"],
        });
        return;
      }

      memberIds.add(key);
    }

    memberIds.add(value.createdBy.toLowerCase());

    if (memberIds.size < 2) {
      ctx.addIssue({
        code: "custom",
        message: "A group must have at least two members",
        path: ["memberIds"],
      });
    }
  });

export type CreateGroupChatBody = z.infer<typeof createGroupChatBodySchema>;

export const addGroupMembersBodySchema = z
  .object({
    memberIds: z
      .array(z.uuid("memberIds must be UUIDs"), "memberIds must be an array of UUIDs")
      .min(1, "memberIds must include at least one member")
      .max(100, "You can add at most 100 members at a time"),
  })
  .superRefine((value, ctx) => {
    const memberIds = new Set<string>();

    for (const memberId of value.memberIds) {
      const key = memberId.toLowerCase();
      if (memberIds.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: "Duplicate member IDs are not allowed",
          path: ["memberIds"],
        });
        return;
      }

      memberIds.add(key);
    }
  });

export type AddGroupMembersBody = z.infer<typeof addGroupMembersBodySchema>;

export const removeGroupMemberParamsSchema = z.object({
  chatId: z.uuid("chatId must be a UUID"),
  memberId: z.uuid("memberId must be a UUID"),
});

export type RemoveGroupMemberParams = z.infer<typeof removeGroupMemberParamsSchema>;

export function resolveGroupMemberIds(createdBy: string, memberIds: string[]): string[] {
  const creatorId = createdBy.toLowerCase();
  const members: string[] = [];
  const seen = new Set<string>();

  for (const memberId of memberIds) {
    const key = memberId.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    members.push(key);
  }

  if (!seen.has(creatorId)) {
    members.unshift(creatorId);
  }

  return members;
}
