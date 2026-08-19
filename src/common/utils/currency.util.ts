import { BadRequestException } from "@nestjs/common";

export const SUPPORTED_CURRENCIES = ["UZS", "TJS", "USD", "EUR", "RUB", "KZT", "KGS"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const normalizeCurrency = (value: unknown): SupportedCurrency => {
  const currency = String(value || "UZS").trim().toUpperCase();
  if (!SUPPORTED_CURRENCIES.includes(currency as SupportedCurrency)) {
    throw new BadRequestException({ code: "INVALID_CURRENCY", message: "Qo'llab-quvvatlanmaydigan valyuta." });
  }
  return currency as SupportedCurrency;
};
