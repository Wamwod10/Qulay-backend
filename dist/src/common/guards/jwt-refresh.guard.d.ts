import { CanActivate, ExecutionContext } from "@nestjs/common";
export declare class JwtRefreshGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean;
}
