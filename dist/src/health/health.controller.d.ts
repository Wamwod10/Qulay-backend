import { HealthService } from "./health.service";
export declare class HealthController {
    private readonly service;
    constructor(service: HealthService);
    check(): Promise<{
        status: string;
        database: string;
        timestamp: string;
    }>;
}
