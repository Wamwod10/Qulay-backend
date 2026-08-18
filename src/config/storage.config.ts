export default () => ({
  storage: {
    provider: process.env.STORAGE_PROVIDER || "local",
    publicUrl: process.env.STORAGE_PUBLIC_URL || null,
  },
});
