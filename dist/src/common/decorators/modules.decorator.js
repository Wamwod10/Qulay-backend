"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequireModules = exports.MODULES_KEY = void 0;
const common_1 = require("@nestjs/common");
exports.MODULES_KEY = "modules";
const RequireModules = (...modules) => (0, common_1.SetMetadata)(exports.MODULES_KEY, modules);
exports.RequireModules = RequireModules;
//# sourceMappingURL=modules.decorator.js.map