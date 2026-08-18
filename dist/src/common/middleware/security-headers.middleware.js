"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.securityHeadersMiddleware = securityHeadersMiddleware;
function securityHeadersMiddleware(_request, response, next) {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Resource-Policy", "same-site");
    if (process.env.NODE_ENV === "production") {
        response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
}
//# sourceMappingURL=security-headers.middleware.js.map