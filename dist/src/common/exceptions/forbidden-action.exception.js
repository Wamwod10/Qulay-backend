"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ForbiddenActionException = void 0;
const common_1 = require("@nestjs/common");
class ForbiddenActionException extends common_1.ForbiddenException {
    constructor(message = "Bu amal uchun ruxsat yo'q.") {
        super({ code: "FORBIDDEN_ACTION", message });
    }
}
exports.ForbiddenActionException = ForbiddenActionException;
//# sourceMappingURL=forbidden-action.exception.js.map