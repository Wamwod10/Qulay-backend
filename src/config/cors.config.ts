export function parseCorsOrigins(value?: string) {
  return (value || "http://localhost:5173")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export default () => ({
  cors: {
    origins: parseCorsOrigins(process.env.FRONTEND_URL),
  },
});
