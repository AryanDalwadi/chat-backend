import { z } from "zod";

export const MAX_MESSAGE_LENGTH = 4000;

export const editMessageParamsSchema = z.object({
  chatId: z.uuid("chatId must be a UUID"),
  messageId: z
    .string("messageId is invalid")
    .trim()
    .min(1, "messageId is invalid")
    .max(128, "messageId is invalid")
    .refine((value) => !value.includes("/"), "messageId is invalid"),
});

export const editMessageBodySchema = z.object({
  text: z
    .string("text is required")
    .trim()
    .min(1, "Message text is required")
    .max(MAX_MESSAGE_LENGTH, `Message text must be at most ${MAX_MESSAGE_LENGTH} characters`),
});

export type EditMessageParams = z.infer<typeof editMessageParamsSchema>;
export type EditMessageBody = z.infer<typeof editMessageBodySchema>;
