import { ForbiddenException } from "@nestjs/common";
export declare class TenantAccessException extends ForbiddenException {
    constructor(message?: string);
}
