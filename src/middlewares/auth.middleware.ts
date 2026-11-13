import type { NextFunction, Request, Response } from "express";
import { getFirebaseAuth } from "../config/firebase.js";

export type AuthedRequest = Request & {
  userId?: string;
  userEmail?: string;
};

export async function authMiddleware(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.header("authorization");

  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }

  try {
    const decoded = await getFirebaseAuth().verifyIdToken(header.slice("Bearer ".length));
    req.userId = decoded.uid;
    if (decoded.email) {
      req.userEmail = decoded.email;
    }
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}
