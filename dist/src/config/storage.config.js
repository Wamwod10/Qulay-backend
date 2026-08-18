"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = () => ({
    storage: {
        provider: process.env.STORAGE_PROVIDER || "local",
        publicUrl: process.env.STORAGE_PUBLIC_URL || null,
    },
});
//# sourceMappingURL=storage.config.js.map