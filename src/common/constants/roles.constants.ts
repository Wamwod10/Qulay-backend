import { SUPER_ADMIN_ROLE } from "./user-role.constants";

export const ROLES = [
  SUPER_ADMIN_ROLE,
  "OWNER",
  "ADMIN",
  "MANAGER",
  "CASHIER",
  "WAREHOUSE",
  "SALES",
  "EMPLOYEE",
] as const;
