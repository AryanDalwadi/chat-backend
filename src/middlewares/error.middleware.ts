import type { ErrorRequestHandler } from "express";

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const errorMiddleware: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : "Internal server error";

  res.status(status).json({ error: message });
};
