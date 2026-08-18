import { NotFoundException } from "@nestjs/common";
export declare class ResourceNotFoundException extends NotFoundException {
    constructor(message?: string);
}
