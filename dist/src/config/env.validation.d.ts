export declare function validateEnv(config: Record<string, unknown>): {
    DATABASE_URL: string;
    PORT: number;
    JWT_SECRET: string;
    JWT_EXPIRES_IN: string;
    FRONTEND_URL: string;
};
