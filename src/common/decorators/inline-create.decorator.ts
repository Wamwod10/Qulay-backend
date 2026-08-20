import { SetMetadata } from "@nestjs/common";

export const INLINE_CREATE_MODULES_KEY = "inlineCreateModules";

/**
 * Marks a POST lookup endpoint that may be called from an already authorised
 * parent workflow (for example Purchase -> Supplier). The parent module is
 * still checked server-side; this is not a client-side permission bypass.
 */
export const AllowInlineCreateFrom = (...modules: string[]) =>
  SetMetadata(INLINE_CREATE_MODULES_KEY, modules);
