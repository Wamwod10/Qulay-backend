import { BadRequestException } from "@nestjs/common";

export const DEFAULT_CURRENCY = "TJS" as const;
export const SUPPORTED_CURRENCIES = [DEFAULT_CURRENCY] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const normalizeCurrency = (value: unknown): SupportedCurrency => {
  const currency = String(value || DEFAULT_CURRENCY).trim().toUpperCase();
  if (!SUPPORTED_CURRENCIES.includes(currency as SupportedCurrency)) {
    throw new BadRequestException({ code: "INVALID_CURRENCY", message: "Qo'llab-quvvatlanmaydigan valyuta." });
  }
  return currency as SupportedCurrency;
};
