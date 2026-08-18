"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResourceNotFoundException = void 0;
const common_1 = require("@nestjs/common");
class ResourceNotFoundException extends common_1.NotFoundException {
    constructor(message = "Ma'lumot topilmadi.") {
        super({ code: "NOT_FOUND", message });
    }
}
exports.ResourceNotFoundException = ResourceNotFoundException;
//# sourceMappingURL=resource-not-found.exception.js.map