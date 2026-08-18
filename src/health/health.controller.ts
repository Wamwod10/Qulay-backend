import { Controller, Get } from "@nestjs/common";

import { Public } from "../common/decorators/public.decorator";
import { HealthService } from "./health.service";

@Public()
@Controller("health")
export class HealthController {
  constructor(private readonly service: HealthService) {}

  @Get()
  check() {
    return this.service.check();
  }
}
