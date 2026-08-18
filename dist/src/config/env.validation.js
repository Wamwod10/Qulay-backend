"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateEnv = validateEnv;
const isProduction = (value) => String(value || "").toLowerCase() === "production";
function validateEnv(config) {
    const production = isProduction(config.NODE_ENV);
    const databaseUrl = String(config.DATABASE_URL || "").trim();
    const jwtSecret = String(config.JWT_SECRET || "").trim();
    const frontendUrl = String(config.FRONTEND_URL || "").trim();
    if (!databaseUrl) {
        throw new Error("DATABASE_URL is required.");
    }
    if (!jwtSecret || (production && jwtSecret.length < 32)) {
        throw new Error("JWT_SECRET must be configured and at least 32 characters in production.");
    }
    if (production && !frontendUrl) {
        throw new Error("FRONTEND_URL is required in production.");
    }
    return {
        ...config,
        DATABASE_URL: databaseUrl,
        PORT: Number(config.PORT || 3000),
        JWT_SECRET: jwtSecret,
        JWT_EXPIRES_IN: String(config.JWT_EXPIRES_IN || "7d"),
        FRONTEND_URL: frontendUrl || "http://localhost:5173",
    };
}
//# sourceMappingURL=env.validation.js.map