import { NextFunction, Request, Response } from "express";

type Bucket = {
  count: number;
  resetAt: number;
};

const AUTH_LIMITS: Record<string, { max: number; windowMs: number }> = {
  "/api/auth/login": { max: 10, windowMs: 60_000 },
  "/api/auth/register": { max: 5, windowMs: 60_000 },
  "/api/auth/reset-password": { max: 5, windowMs: 60_000 },
};

export function createAuthRateLimitMiddleware() {
  const buckets = new Map<string, Bucket>();

  return function authRateLimitMiddleware(request: Request, response: Response, next: NextFunction) {
    const limit = AUTH_LIMITS[request.path];
    if (!limit) {
      next();
      return;
    }

    const now = Date.now();
    const key = `${request.path}:${request.ip || "unknown"}`;
    const current = buckets.get(key);
    const bucket = !current || current.resetAt <= now
      ? { count: 1, resetAt: now + limit.windowMs }
      : { count: current.count + 1, resetAt: current.resetAt };

    buckets.set(key, bucket);

    if (bucket.count > limit.max) {
      response.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000));
      response.status(429).json({
        statusCode: 429,
        code: "AUTH_RATE_LIMITED",
        message: "Juda ko'p urinish. Keyinroq qayta urinib ko'ring.",
        path: request.url,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    for (const [bucketKey, value] of buckets) {
      if (value.resetAt <= now) buckets.delete(bucketKey);
    }

    next();
  };
}
