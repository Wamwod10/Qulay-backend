"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createConfiguredApp = createConfiguredApp;
require("reflect-metadata");
const config_1 = require("@nestjs/config");
const core_1 = require("@nestjs/core");
const express_1 = require("express");
const app_module_1 = require("./app.module");
const validation_pipe_1 = require("./common/pipes/validation.pipe");
const app_exception_filter_1 = require("./common/filters/app-exception.filter");
const auth_rate_limit_middleware_1 = require("./common/middleware/auth-rate-limit.middleware");
const security_headers_middleware_1 = require("./common/middleware/security-headers.middleware");
const cors_config_1 = require("./config/cors.config");
async function createConfiguredApp() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { bodyParser: false });
    const config = app.get(config_1.ConfigService);
    const frontendUrl = config.get("FRONTEND_URL");
    const origins = (0, cors_config_1.parseCorsOrigins)(frontendUrl);
    app.set("trust proxy", 1);
    app.use((0, express_1.json)({ limit: "1mb" }));
    app.use((0, express_1.urlencoded)({ extended: true, limit: "1mb" }));
    app.use(security_headers_middleware_1.securityHeadersMiddleware);
    app.use((0, auth_rate_limit_middleware_1.createAuthRateLimitMiddleware)());
    app.setGlobalPrefix("api");
    app.enableCors({
        origin: (origin, callback) => {
            if (!origin || origins.includes(origin)) {
                callback(null, true);
                return;
            }
            callback(null, false);
        },
        credentials: true,
        allowedHeaders: ["Content-Type", "Authorization", "X-Company-Id", "X-Branch-Id", "X-Warehouse-Id", "Idempotency-Key"],
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    });
    app.useGlobalPipes(validation_pipe_1.AppValidationPipe);
    app.useGlobalFilters(new app_exception_filter_1.AppExceptionFilter());
    return app;
}
//# sourceMappingURL=app.factory.js.map