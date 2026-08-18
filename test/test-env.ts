import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readEnvFile(filePath: string) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

export function loadTestEnv() {
  const file = readEnvFile(resolve(process.cwd(), ".env.test"));
  for (const line of file.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }

  const databaseUrl = String(process.env.TEST_DATABASE_URL || "").trim();
  if (!databaseUrl) {
    throw new Error("TEST_DATABASE_URL is required. Copy backend/.env.test.example to backend/.env.test and use a dedicated test database.");
  }

  const parsed = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!/(^|[_-])test([_-]|$)/i.test(databaseName)) {
    throw new Error("Refusing to run tests: TEST_DATABASE_URL must point to a database whose name contains 'test'.");
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === databaseUrl) {
    throw new Error("Refusing to run tests against DATABASE_URL. Use a separate TEST_DATABASE_URL.");
  }

  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET ||= "test-only-secret-with-at-least-thirty-two-characters";
  process.env.JWT_EXPIRES_IN ||= "1h";
  process.env.FRONTEND_URL ||= "http://localhost:5173";
  return databaseUrl;
}
