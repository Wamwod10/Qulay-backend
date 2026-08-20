import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

type ErrorBody = {
  code?: string;
  message?: string | string[];
  error?: string;
  field?: string;
  details?: unknown;
};

const sanitizeLogMessage = (value: string) =>
  value
    .replace(/(postgres(?:ql)?:\/\/)[^\s]+/gi, "$1[REDACTED]")
    .replace(
      /((?:password|passwd|secret|token|jwt|authorization|database_url)\s*[=:]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    );

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    const path = String(request.url || "").split("?")[0];

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const codeMap: Record<
        string,
        { code: string; message: string; status: number }
      > = {
        P2002: {
          code: "DUPLICATE_RECORD",
          message: "Bu qiymat allaqachon mavjud.",
          status: 409,
        },
        P2003: {
          code: "RELATED_RECORD_INVALID",
          message: "Bog'langan ma'lumot yaroqsiz yoki mavjud emas.",
          status: 409,
        },
        P2014: {
          code: "RELATED_RECORD_CONFLICT",
          message: "Bu ma'lumot boshqa tarix bilan bog'langan.",
          status: 409,
        },
        P2021: {
          code: "DATABASE_SCHEMA_NOT_READY",
          message:
            "Tizim ma'lumotlar bazasi yangilanmoqda. Keyinroq urinib ko'ring.",
          status: 503,
        },
        P2025: {
          code: "NOT_FOUND",
          message: "Ma'lumot topilmadi.",
          status: 404,
        },
        P2028: {
          code: "DATABASE_TRANSACTION_FAILED",
          message: "Amal yakunlanmadi. Qayta urinib ko'ring.",
          status: 409,
        },
      };
      const mapped = codeMap[exception.code] || {
        code: "DATABASE_OPERATION_FAILED",
        message: "Amalni bajarib bo'lmadi. Qayta urinib ko'ring.",
        status: 500,
      };

      const status = mapped.status;

      this.logger.error(
        `database.request_failed code=${exception.code} path=${path} meta=${sanitizeLogMessage(
          JSON.stringify(exception.meta || {}),
        )}`,
      );

      const target = Array.isArray(exception.meta?.target)
        ? exception.meta.target[0]
        : undefined;

      response.status(status).json({
        statusCode: status,
        code: mapped.code,
        message: mapped.message,
        ...(target ? { field: target } : {}),
        path,
        timestamp: new Date().toISOString(),
      });

      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const body =
        typeof payload === "object" && payload !== null
          ? (payload as ErrorBody)
          : undefined;
      const message =
        typeof payload === "string"
          ? payload
          : body?.message || exception.message;
      response.status(status).json({
        statusCode: status,
        code: body?.code || body?.error || exception.name,
        message,
        ...(body?.field ? { field: body.field } : {}),
        ...(body?.details ? { details: body.details } : {}),
      });
      return;
    }

    this.logger.error(
      sanitizeLogMessage(
        exception instanceof Error
          ? exception.message
          : "Unknown backend exception",
      ),
    );
    response.status(500).json({
      statusCode: 500,
      code: "INTERNAL_SERVER_ERROR",
      message: "Amalni bajarib bo'lmadi. Qayta urinib ko'ring.",
    });
  }
}
