import { ValidationPipe } from "@nestjs/common";

export const AppValidationPipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
  validationError: {
    target: false,
    value: false,
  },
});
