import { NextFunction, Request, Response } from "express";
export declare function createAuthRateLimitMiddleware(): (request: Request, response: Response, next: NextFunction) => void;
