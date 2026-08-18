import { ForbiddenException } from "@nestjs/common";

export class ForbiddenActionException extends ForbiddenException {
  constructor(message = "Bu amal uchun ruxsat yo'q.") {
    super({ code: "FORBIDDEN_ACTION", message });
  }
}
