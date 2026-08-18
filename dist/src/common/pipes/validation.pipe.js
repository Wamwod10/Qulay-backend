"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppValidationPipe = void 0;
const common_1 = require("@nestjs/common");
exports.AppValidationPipe = new common_1.ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    validationError: {
        target: false,
        value: false,
    },
});
//# sourceMappingURL=validation.pipe.js.map