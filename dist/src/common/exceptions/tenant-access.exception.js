"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantAccessException = void 0;
const common_1 = require("@nestjs/common");
class TenantAccessException extends common_1.ForbiddenException {
    constructor(message = "Bu kompaniya ma'lumotlariga ruxsat yo'q.") {
        super({ code: "TENANT_FORBIDDEN", message });
    }
}
exports.TenantAccessException = TenantAccessException;
//# sourceMappingURL=tenant-access.exception.js.map