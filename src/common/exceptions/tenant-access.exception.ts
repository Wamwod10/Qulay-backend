import { ForbiddenException } from "@nestjs/common";

export class TenantAccessException extends ForbiddenException {
  constructor(message = "Bu kompaniya ma'lumotlariga ruxsat yo'q.") {
    super({ code: "TENANT_FORBIDDEN", message });
  }
}
