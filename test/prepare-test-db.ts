import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { loadTestEnv } from "./test-env";

loadTestEnv();

const command = resolve(process.cwd(), "node_modules/prisma/build/index.js");
execFileSync(process.execPath, [command, "migrate", "deploy"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});
