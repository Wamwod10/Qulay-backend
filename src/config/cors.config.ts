export function normalizeCorsOrigin(value: string) {
  const raw = String(value || "").trim();

  if (!raw) {
    return "";
  }

  if (raw.includes("*")) {
    return raw.replace(/\/+$/, "");
  }

  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

export function parseCorsOrigins(value?: string) {
  const configured = String(value || "").trim();

  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("FRONTEND_URL is required in production.");
  }

  return (configured || "http://localhost:5173")
    .split(",")
    .map((item) => normalizeCorsOrigin(item))
    .filter(Boolean);
}

export function isCorsOriginAllowed(origin: string | undefined, allowedOrigins: string[]) {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = normalizeCorsOrigin(origin);

  return allowedOrigins.some((allowedOrigin) => {
    if (allowedOrigin === normalizedOrigin) {
      return true;
    }

    const wildcard = /^https?:\/\/\*\.(.+)$/i.exec(allowedOrigin);

    if (!wildcard) {
      return false;
    }

    const allowedProtocol = allowedOrigin.split("://")[0].toLowerCase();
    const originUrl = new URL(normalizedOrigin);

    return (
      originUrl.protocol.replace(":", "").toLowerCase() === allowedProtocol &&
      originUrl.hostname.endsWith(`.${wildcard[1].toLowerCase()}`)
    );
  });
}

export default () => ({
  cors: {
    origins: parseCorsOrigins(process.env.FRONTEND_URL),
  },
});
