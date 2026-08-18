import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export const CurrentCompany = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();

  return request.companyId || request.user?.companyId || null;
});
