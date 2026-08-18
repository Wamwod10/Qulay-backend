import { CanActivate, Injectable } from "@nestjs/common";

@Injectable()
export class SubscriptionGuard implements CanActivate {
  canActivate() {
    return true;
  }
}
