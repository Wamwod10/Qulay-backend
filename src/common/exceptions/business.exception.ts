import { BadRequestException } from "@nestjs/common";

export class BusinessException extends BadRequestException {
  constructor(message: string, code = "BUSINESS_RULE") {
    super({ code, message });
  }
}
