import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCorsOrigins } from "../../src/config/cors.config";
import { validateEnv } from "../../src/config/env.validation";
import { createAuthRateLimitMiddleware } from "../../src/common/middleware/auth-rate-limit.middleware";

test("CORS config parses a strict comma-separated whitelist", () => {
  assert.deepEqual(parseCorsOrigins("https://app.example.com, http://localhost:5173"), [
    "https://app.example.com",
    "http://localhost:5173",
  ]);
});

test("production environment validation rejects a short JWT secret", () => {
  assert.throws(
    () => validateEnv({ NODE_ENV: "production", DATABASE_URL: "postgresql://db/app", JWT_SECRET: "short", FRONTEND_URL: "https://app.example.com" }),
    /JWT_SECRET/,
  );
});

test("auth rate limiter applies only to configured auth routes", () => {
  const middleware = createAuthRateLimitMiddleware();
  let limited = 0;
  const request = { path: "/api/auth/login", url: "/api/auth/login", ip: "127.0.0.1" } as any;
  const response = {
    setHeader() { return this; },
    status() { limited += 1; return this; },
    json() { return this; },
  } as any;
  let nextCalls = 0;

  for (let index = 0; index < 11; index += 1) middleware(request, response, () => { nextCalls += 1; });

  assert.equal(nextCalls, 10);
  assert.equal(limited, 1);
});

test("auth rate limiter does not throttle normal CRUD routes", () => {
  const middleware = createAuthRateLimitMiddleware();
  let nextCalls = 0;
  const request = { path: "/api/products", url: "/api/products", ip: "127.0.0.1" } as any;
  const response = {} as any;

  for (let index = 0; index < 20; index += 1) middleware(request, response, () => { nextCalls += 1; });

  assert.equal(nextCalls, 20);
});
