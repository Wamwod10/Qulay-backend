"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var AppExceptionFilter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppExceptionFilter = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const sanitizeLogMessage = (value) => value
    .replace(/(postgres(?:ql)?:\/\/)[^\s]+/gi, "$1[REDACTED]")
    .replace(/((?:password|passwd|secret|token|jwt|authorization|database_url)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");
let AppExceptionFilter = AppExceptionFilter_1 = class AppExceptionFilter {
    logger = new common_1.Logger(AppExceptionFilter_1.name);
    catch(exception, host) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();
        const path = String(request.url || "").split("?")[0];
        if (exception instanceof client_1.Prisma.PrismaClientKnownRequestError) {
            const status = exception.code === "P2025" ? 404 : 409;
            response.status(status).json({
                statusCode: status,
                code: exception.code === "P2025" ? "NOT_FOUND" : exception.code === "P2002" ? "UNIQUE_CONSTRAINT" : exception.code,
                message: exception.code === "P2025" ? "Ma'lumot topilmadi." : exception.code === "P2002" ? "Bu qiymat allaqachon mavjud." : "Database amali bajarilmadi.",
                path,
                timestamp: new Date().toISOString(),
            });
            return;
        }
        if (exception instanceof common_1.HttpException) {
            const status = exception.getStatus();
            const payload = exception.getResponse();
            const body = typeof payload === "object" && payload !== null ? payload : undefined;
            response.status(status).json({
                statusCode: status,
                code: body?.code || body?.error || exception.name,
                message: typeof payload === "string" ? payload : body?.message || exception.message,
                path,
                timestamp: new Date().toISOString(),
            });
            return;
        }
        this.logger.error(sanitizeLogMessage(exception instanceof Error ? exception.message : "Unknown backend exception"));
        response.status(500).json({
            statusCode: 500,
            code: "INTERNAL_SERVER_ERROR",
            message: "Ichki server xatosi.",
            path,
            timestamp: new Date().toISOString(),
        });
    }
};
exports.AppExceptionFilter = AppExceptionFilter;
exports.AppExceptionFilter = AppExceptionFilter = AppExceptionFilter_1 = __decorate([
    (0, common_1.Catch)()
], AppExceptionFilter);
//# sourceMappingURL=app-exception.filter.js.map