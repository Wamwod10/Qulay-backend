import { ForbiddenException } from "@nestjs/common";
export declare class ForbiddenActionException extends ForbiddenException {
    constructor(message?: string);
}
