import "reflect-metadata";

import { ConfigService } from "@nestjs/config";

import { createConfiguredApp } from "./app.factory";

async function bootstrap() {
  const app = await createConfiguredApp();
  const config = app.get(ConfigService);
  const port = Number(config.get<string | number>("PORT") || 3000);

  await app.listen(port);
}

void bootstrap();
