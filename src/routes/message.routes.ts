import { Router } from "express";
import {
  editMessage,
  getMessages,
  markMessageRead,
  sendMessage,
  updateLastSeen,
} from "../controllers/message.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

export const messageRoutes = Router();

messageRoutes.post("/:chatId/message/send", sendMessage);
messageRoutes.put("/:chatId/message/:messageId", authMiddleware, editMessage);
messageRoutes.post("/:chatId/message/:messageId/read", authMiddleware, markMessageRead);
messageRoutes.get("/:chatId/messages", authMiddleware, getMessages);
messageRoutes.post("/:chatId/lastseen", authMiddleware, updateLastSeen);
