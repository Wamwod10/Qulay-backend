import { NotFoundException } from "@nestjs/common";

export class ResourceNotFoundException extends NotFoundException {
  constructor(message = "Ma'lumot topilmadi.") {
    super({ code: "NOT_FOUND", message });
  }
}
