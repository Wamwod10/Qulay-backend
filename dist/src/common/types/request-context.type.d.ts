import { CurrentUserPayload } from "./current-user.type";
export interface RequestContext {
    user?: CurrentUserPayload;
    companyId?: string | null;
    requestId?: string;
}
