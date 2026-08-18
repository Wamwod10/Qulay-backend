"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CurrentCompany = void 0;
const common_1 = require("@nestjs/common");
exports.CurrentCompany = (0, common_1.createParamDecorator)((_data, ctx) => {
    const request = ctx.switchToHttp().getRequest();
    return request.companyId || request.user?.companyId || null;
});
//# sourceMappingURL=current-company.decorator.js.map