import { Router } from "express";
import {
  addGroupMembers,
  createChat,
  removeGroupMember,
  createGroupChat,
  createMessage,
  createOrGetChat,
  listChats,
  listMessages,
  listUserChats,
} from "../controllers/chat.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

export const apiChatRoutes = Router();

apiChatRoutes.post("/create", createOrGetChat);
apiChatRoutes.post("/group/create", authMiddleware, createGroupChat);
apiChatRoutes.post("/group/:chatId/members/add", authMiddleware, addGroupMembers);
apiChatRoutes.delete("/group/:chatId/members/:memberId", authMiddleware, removeGroupMember);

export const userChatRoutes = Router();

userChatRoutes.get("/:userId/chats", listUserChats);

export const chatRoutes = Router();

chatRoutes.use(authMiddleware);
chatRoutes.post("/", createChat);
chatRoutes.get("/", listChats);
chatRoutes.get("/:chatId/messages", listMessages);
chatRoutes.post("/:chatId/messages", createMessage);
