"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCorsOrigins = parseCorsOrigins;
function parseCorsOrigins(value) {
    return (value || "http://localhost:5173")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}
exports.default = () => ({
    cors: {
        origins: parseCorsOrigins(process.env.FRONTEND_URL),
    },
});
//# sourceMappingURL=cors.config.js.map