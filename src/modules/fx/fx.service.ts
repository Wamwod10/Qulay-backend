import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { normalizeCurrency, SUPPORTED_CURRENCIES, SupportedCurrency } from "../../common/utils/currency.util";
import { roundMoney, toNumber } from "../../common/utils/money.util";
import { PrismaService } from "../../database/prisma.service";

type FxRateRecord = {
  fromCurrency: SupportedCurrency;
  toCurrency: SupportedCurrency;
  rate: number;
  provider: string;
  source: string;
  fetchedAt: string;
  effectiveAt: string | null;
  expiresAt: string | null;
  fallback: boolean;
};

type CachedProviderRates = {
  baseCurrency: SupportedCurrency;
  rates: Record<string, number>;
  provider: string;
  fetchedAt: string;
  effectiveAt: string | null;
  expiresAt: string;
};

const REQUEST_TIMEOUT_MS = 10_000;

@Injectable()
export class FxService {
  private readonly ttlMs: number;
  private readonly provider: string;
  private readonly apiKey: string;
  private readonly currentRates = new Map<SupportedCurrency, CachedProviderRates>();
  private readonly lastKnownRates = new Map<SupportedCurrency, CachedProviderRates>();
  private readonly inFlightRefreshes = new Map<SupportedCurrency, Promise<CachedProviderRates>>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.ttlMs = Math.max(Number(this.config.get("FX_RATE_TTL_MINUTES") || 45), 1) * 60 * 1000;
    this.provider = String(this.config.get("FX_PROVIDER") || "exchangerate-api").trim().toLowerCase();
    this.apiKey = String(this.config.get("FX_API_KEY") || "").trim();
  }

  getCacheTtlMinutes() {
    return Math.round(this.ttlMs / 60_000);
  }

  async getRate(fromCurrency: unknown, toCurrency: unknown): Promise<FxRateRecord | null> {
    const from = normalizeCurrency(fromCurrency);
    const to = normalizeCurrency(toCurrency);

    if (from === to) {
      const now = new Date().toISOString();

      return {
        fromCurrency: from,
        toCurrency: to,
        rate: 1,
        provider: "internal",
        source: "same-currency",
        fetchedAt: now,
        effectiveAt: now,
        expiresAt: now,
        fallback: false,
      };
    }

    const providerRates = await this.getProviderRates(from);
    const rate = this.pickRate(providerRates, to);

    if (rate) {
      const fallback = Date.now() >= Date.parse(providerRates.expiresAt);
      return this.toRateRecord(providerRates, from, to, rate, fallback);
    }

    const lastKnown = this.lastKnownRates.get(from);
    const lastKnownRate = lastKnown ? this.pickRate(lastKnown, to) : null;

    if (lastKnown && lastKnownRate) {
      return this.toRateRecord(lastKnown, from, to, lastKnownRate, true);
    }

    return null;
  }

  async getRates(baseCurrency: unknown, symbols: unknown) {
    const base = normalizeCurrency(baseCurrency);
    const targets = this.normalizeSymbols(symbols);
    const rates: Record<string, FxRateRecord> = {};
    const unavailable: SupportedCurrency[] = [];

    await Promise.all(targets.map(async (target) => {
      try {
        const rate = await this.getRate(base, target);
        if (rate) {
          rates[`${base}:${target}`] = rate;
        } else {
          unavailable.push(target);
        }
      } catch {
        unavailable.push(target);
      }
    }));

    return {
      baseCurrency: base,
      provider: this.providerLabel(),
      cacheTtlMinutes: this.getCacheTtlMinutes(),
      rates,
      unavailable,
    };
  }

  async convertMoney(input: { amount: unknown; fromCurrency: unknown; toCurrency: unknown }) {
    const amount = toNumber(input.amount);
    let rate: FxRateRecord | null = null;

    try {
      rate = await this.getRate(input.fromCurrency, input.toCurrency);
    } catch {
      rate = null;
    }

    if (!rate) {
      return {
        available: false,
        amount: null,
        fromCurrency: normalizeCurrency(input.fromCurrency),
        toCurrency: normalizeCurrency(input.toCurrency),
        rate: null,
      };
    }

    return {
      ...rate,
      available: true,
      amount: roundMoney(amount * rate.rate, 6),
      originalAmount: amount,
    };
  }

  private async getProviderRates(baseCurrency: SupportedCurrency) {
    const cached = this.currentRates.get(baseCurrency);

    if (cached && Date.now() < Date.parse(cached.expiresAt)) {
      return cached;
    }

    if (cached) {
      void this.refreshProviderRates(baseCurrency).catch(() => undefined);
      return cached;
    }

    // Restore the last successful table from PostgreSQL. This makes FX
    // resilient to Render/process restarts and lets the UI keep converting
    // during a short provider outage.
    const persisted = await this.loadPersistedRates(baseCurrency);
    if (persisted) {
      this.lastKnownRates.set(baseCurrency, persisted);
      if (Date.now() < Date.parse(persisted.expiresAt)) {
        this.currentRates.set(baseCurrency, persisted);
        return persisted;
      }
    }

    const lastKnown = this.lastKnownRates.get(baseCurrency);

    try {
      return await this.refreshProviderRates(baseCurrency);
    } catch (error) {
      if (lastKnown) {
        return lastKnown;
      }

      throw error;
    }
  }

  private async refreshProviderRates(baseCurrency: SupportedCurrency) {
    const current = this.inFlightRefreshes.get(baseCurrency);
    if (current) {
      return current;
    }

    const promise = this.fetchProviderRates(baseCurrency)
      .then(async (rates) => {
        this.currentRates.set(baseCurrency, rates);
        this.lastKnownRates.set(baseCurrency, rates);
        await this.persistRates(rates).catch(() => undefined);
        return rates;
      })
      .finally(() => {
        this.inFlightRefreshes.delete(baseCurrency);
      });

    this.inFlightRefreshes.set(baseCurrency, promise);
    return promise;
  }

  private async fetchProviderRates(baseCurrency: SupportedCurrency): Promise<CachedProviderRates> {
    const response = await this.fetchJson(this.providerUrl(baseCurrency));
    const payload = this.normalizeProviderResponse(response, baseCurrency);

    return {
      ...payload,
      expiresAt: new Date(Date.now() + this.ttlMs).toISOString(),
    };
  }

  private async loadPersistedRates(baseCurrency: SupportedCurrency): Promise<CachedProviderRates | null> {
    try {
      const row = await this.prisma.fxRateCache.findUnique({ where: { baseCurrency } });
      if (!row || !row.rates || typeof row.rates !== "object") return null;
      return {
        baseCurrency,
        rates: row.rates as Record<string, number>,
        provider: row.provider,
        fetchedAt: row.fetchedAt.toISOString(),
        effectiveAt: row.effectiveAt || null,
        expiresAt: row.expiresAt.toISOString(),
      };
    } catch {
      // The table may not exist until the additive migration is deployed.
      return null;
    }
  }

  private async persistRates(rates: CachedProviderRates) {
    await this.prisma.fxRateCache.upsert({
      where: { baseCurrency: rates.baseCurrency },
      update: {
        rates: rates.rates,
        provider: rates.provider,
        fetchedAt: new Date(rates.fetchedAt),
        effectiveAt: rates.effectiveAt,
        expiresAt: new Date(rates.expiresAt),
      },
      create: {
        baseCurrency: rates.baseCurrency,
        rates: rates.rates,
        provider: rates.provider,
        fetchedAt: new Date(rates.fetchedAt),
        effectiveAt: rates.effectiveAt,
        expiresAt: new Date(rates.expiresAt),
      },
    });
  }

  private providerUrl(baseCurrency: SupportedCurrency) {
    if (this.provider === "fawaz-currency-api") {
      return `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${baseCurrency.toLowerCase()}.min.json`;
    }

    if (this.apiKey) {
      return `https://v6.exchangerate-api.com/v6/${encodeURIComponent(this.apiKey)}/latest/${baseCurrency}`;
    }

    return `https://open.er-api.com/v6/latest/${baseCurrency}`;
  }

  private async fetchJson(url: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`FX provider returned ${response.status}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeProviderResponse(payload: any, baseCurrency: SupportedCurrency): Omit<CachedProviderRates, "expiresAt"> {
    if (this.provider === "fawaz-currency-api") {
      const rates = payload?.[baseCurrency.toLowerCase()];
      return this.validateRates({
        baseCurrency,
        rates,
        provider: "fawaz-currency-api",
        fetchedAt: new Date().toISOString(),
        effectiveAt: payload?.date || null,
      });
    }

    return this.validateRates({
      baseCurrency,
      rates: payload?.conversion_rates || payload?.rates,
      provider: payload?.provider || "ExchangeRate-API",
      fetchedAt: new Date().toISOString(),
      effectiveAt: payload?.time_last_update_utc || null,
    });
  }

  private validateRates(input: Omit<CachedProviderRates, "expiresAt">) {
    if (!input.rates || typeof input.rates !== "object") {
      throw new Error("FX provider response does not include rates.");
    }

    const rates = Object.entries(input.rates).reduce<Record<string, number>>((result, [currency, value]) => {
      const normalized = String(currency || "").trim().toUpperCase();
      const rate = Number(value);

      if (SUPPORTED_CURRENCIES.includes(normalized as SupportedCurrency) && Number.isFinite(rate) && rate > 0) {
        result[normalized] = rate;
      }

      return result;
    }, {});

    if (!this.pickRate({ ...input, rates, expiresAt: "" }, input.baseCurrency)) {
      rates[input.baseCurrency] = 1;
    }

    return {
      ...input,
      rates,
    };
  }

  private pickRate(providerRates: CachedProviderRates, currency: SupportedCurrency) {
    const rate = Number(providerRates.rates[currency]);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  }

  private toRateRecord(
    providerRates: CachedProviderRates,
    fromCurrency: SupportedCurrency,
    toCurrency: SupportedCurrency,
    rate: number,
    fallback: boolean,
  ): FxRateRecord {
    return {
      fromCurrency,
      toCurrency,
      rate,
      provider: providerRates.provider,
      source: fallback ? "last-known-rate" : "live-cache",
      fetchedAt: providerRates.fetchedAt,
      effectiveAt: providerRates.effectiveAt,
      expiresAt: providerRates.expiresAt,
      fallback,
    };
  }

  private normalizeSymbols(symbols: unknown) {
    const raw = Array.isArray(symbols)
      ? symbols
      : String(symbols || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

    const selected = raw.length > 0 ? raw : SUPPORTED_CURRENCIES;

    return [...new Set(selected.map((item) => normalizeCurrency(item)))];
  }

  private providerLabel() {
    if (this.provider === "fawaz-currency-api") {
      return "fawaz-currency-api";
    }

    return this.apiKey ? "ExchangeRate-API" : "ExchangeRate-API Open Access";
  }
}
