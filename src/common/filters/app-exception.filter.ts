import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";

type ErrorBody = {
  code?: string;
  message?: string | string[];
  error?: string;
};

const sanitizeLogMessage = (value: string) => value
  .replace(/(postgres(?:ql)?:\/\/)[^\s]+/gi, "$1[REDACTED]")
  .replace(/((?:password|passwd|secret|token|jwt|authorization|database_url)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    const path = String(request.url || "").split("?")[0];

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
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

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const body = typeof payload === "object" && payload !== null ? payload as ErrorBody : undefined;
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
}
