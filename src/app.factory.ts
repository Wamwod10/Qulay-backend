import "reflect-metadata";

import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { json, urlencoded } from "express";

import { AppModule } from "./app.module";
import { AppValidationPipe } from "./common/pipes/validation.pipe";
import { AppExceptionFilter } from "./common/filters/app-exception.filter";
import { createAuthRateLimitMiddleware } from "./common/middleware/auth-rate-limit.middleware";
import { securityHeadersMiddleware } from "./common/middleware/security-headers.middleware";
import { isCorsOriginAllowed, parseCorsOrigins } from "./config/cors.config";

export async function createConfiguredApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get(ConfigService);
  const frontendUrl = config.get<string>("FRONTEND_URL");
  const origins = parseCorsOrigins(frontendUrl);

  (app as INestApplication & { set: (name: string, value: unknown) => void }).set("trust proxy", 1);
  app.use(json({ limit: "1mb" }));
  app.use(urlencoded({ extended: true, limit: "1mb" }));
  app.use(securityHeadersMiddleware);
  app.use(createAuthRateLimitMiddleware());
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: (origin, callback) => {
      if (isCorsOriginAllowed(origin, origins)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Company-Id", "X-Branch-Id", "X-Warehouse-Id", "Idempotency-Key", "X-Inline-Parent-Module"],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });
  app.useGlobalPipes(AppValidationPipe);
  app.useGlobalFilters(new AppExceptionFilter());

  return app;
}
