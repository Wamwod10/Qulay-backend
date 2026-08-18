import { BadRequestException } from "@nestjs/common";
export declare class BusinessException extends BadRequestException {
    constructor(message: string, code?: string);
}
