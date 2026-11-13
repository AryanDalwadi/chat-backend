import cors from "cors";
import express from "express";
import { errorMiddleware } from "./middlewares/error.middleware.js";
import { apiChatRoutes, chatRoutes, userChatRoutes } from "./routes/chat.routes.js";
import { messageRoutes } from "./routes/message.routes.js";

export const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/chats", chatRoutes);
app.use("/api/chat", apiChatRoutes);
app.use("/api/user", userChatRoutes);
app.use("/api/chat", messageRoutes);
app.use(errorMiddleware);
