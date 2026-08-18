"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CurrentBranch = void 0;
const common_1 = require("@nestjs/common");
exports.CurrentBranch = (0, common_1.createParamDecorator)((_data, ctx) => {
    const request = ctx.switchToHttp().getRequest();
    return request.headers["x-branch-id"] || null;
});
//# sourceMappingURL=current-branch.decorator.js.map