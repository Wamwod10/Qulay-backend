"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = () => ({
    jwt: {
        secret: process.env.JWT_SECRET,
        expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    },
});
//# sourceMappingURL=jwt.config.js.map