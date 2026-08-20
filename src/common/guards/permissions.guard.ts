import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { PERMISSIONS_KEY } from "../decorators/permissions.decorator";
import { SUPER_ADMIN_ROLE } from "../constants/user-role.constants";

const BUSINESS_PERMISSION_RULES: Record<string, string | undefined> = {
  "/products": "products",
  "/categories": "categories",
  "/suppliers": "suppliers",
  "/purchases": "purchases",
  "/sales": "sales",
  "/customers": "customers",
  "/agents": "agents",
  "/inventory": "warehouse",
  "/warehouses": "warehouse",
  "/manufacturing": "manufacturing",
  "/finance": "finance",
  "/employees": "employees",
  "/reports": "reports",
  "/dashboard": "dashboard",
  "/settings": "settings",
};

export const inferBusinessPermission = (request: any) => {
  const rawPath = String(request.route?.path || request.path || request.url || "").split("?")[0];
  const path = rawPath.replace(/^\/api(?=\/|$)/, "") || "/";
  const resourcePath = Object.keys(BUSINESS_PERMISSION_RULES).find((key) => path === key || path.startsWith(`${key}/`));
  const resource = resourcePath ? BUSINESS_PERMISSION_RULES[resourcePath] : undefined;

  if (!resource) return null;

  const method = String(request.method || "GET").toUpperCase();
  const isRoot = path === resourcePath;
  const action = path.split("/").filter(Boolean).pop();

  if (resource === "categories") return method === "GET" ? "products.view" : method === "POST" ? "categories.create" : "products.manage";
  if (resource === "warehouse") return method === "GET" ? "warehouse.view" : "warehouse.manage";
  if (resource === "sales") {
    if (method === "GET") return "sales.view";
    if (method === "POST" && (isRoot || action === "complete")) return "sales.create";
    if (action === "cancel") return "sales.cancel";
    if (action === "return") return "sales.return";
    if (method === "PATCH") return "sales.update";
    if (method === "DELETE") return "sales.delete";
    return "sales.manage";
  }
  if (resource === "purchases") {
    if (method === "GET") return "purchases.view";
    if (method === "POST" && isRoot) return "purchases.create";
    if (method === "PATCH" || method === "POST") return "purchases.update";
    if (method === "DELETE") return "purchases.delete";
    return "purchases.manage";
  }
  if (resource === "manufacturing") {
    if (method === "GET") return "manufacturing.view";
    if (method === "POST" && isRoot) return "manufacturing.manage";
    if (method === "POST" && action === "orders") return "manufacturing.order.create";
    return "manufacturing.manage";
  }
  if (resource === "finance") return method === "GET" ? "finance.view" : method === "POST" ? "finance.create" : "finance.manage";
  if (resource === "reports" || resource === "dashboard") return `${resource}.view`;
  if (resource === "settings") return method === "GET" ? "settings.view" : "settings.manage";
  if (method === "GET") return `${resource}.view`;
  if (resource === "products" && method === "POST" && action === "duplicate") return "products.create";
  if (method === "POST" && isRoot) return `${resource}.create`;
  if (method === "DELETE") return `${resource}.delete`;
  if (method === "PATCH") return `${resource}.update`;
  return `${resource}.manage`;
};

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector = new Reflector()) {}

  canActivate(context: ExecutionContext) {
    const permissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const user = context.switchToHttp().getRequest().user;
    const request = context.switchToHttp().getRequest();
    const requiredPermissions = permissions?.length ? permissions : [inferBusinessPermission(request)].filter(Boolean) as string[];

    if (!requiredPermissions.length) return true;

    if (user?.role === SUPER_ADMIN_ROLE || user?.permissions?.includes("*")) {
      return true;
    }

    const allowed = user?.role === "OWNER" || user?.role === "ADMIN"
      || requiredPermissions.every((permission) => user?.permissions?.includes(permission));

    if (!allowed) {
      throw new ForbiddenException({
        code: "PERMISSION_FORBIDDEN",
        message: "Bu amal uchun ruxsat yo'q.",
      });
    }

    return true;
  }
}
