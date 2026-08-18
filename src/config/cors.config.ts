export function parseCorsOrigins(value?: string) {
  const configured = String(value || "").trim();

  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("FRONTEND_URL is required in production.");
  }

  return (configured || "http://localhost:5173")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export default () => ({
  cors: {
    origins: parseCorsOrigins(process.env.FRONTEND_URL),
  },
});
