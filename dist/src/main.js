"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const config_1 = require("@nestjs/config");
const app_factory_1 = require("./app.factory");
async function bootstrap() {
    const app = await (0, app_factory_1.createConfiguredApp)();
    const config = app.get(config_1.ConfigService);
    const port = Number(config.get("PORT") || 3000);
    await app.listen(port);
}
void bootstrap();
//# sourceMappingURL=main.js.map