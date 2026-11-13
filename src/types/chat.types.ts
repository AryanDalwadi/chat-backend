import { z } from "zod";

export const createChatBodySchema = z.object({
  participantIds: z.array(z.string().min(1)).min(1),
});

export const createMessageBodySchema = z.object({
  body: z.string().trim().min(1),
});

export type CreateChatBody = z.infer<typeof createChatBodySchema>;
export type CreateMessageBody = z.infer<typeof createMessageBodySchema>;

export type Chat = {
  id: string;
  participantIds: string[];
  createdAt: Date;
};

export type Message = {
  id: string;
  chatId: string;
  senderId: string;
  body: string;
  createdAt: Date;
};
