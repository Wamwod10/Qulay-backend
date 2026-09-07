import { Controller, Get, Query } from "@nestjs/common";

import { FxService } from "./fx.service";

@Controller("fx")
export class FxController {
  constructor(private readonly fx: FxService) {}

  @Get("rates")
  rates(@Query("base") base: string, @Query("symbols") symbols: string) {
    return this.fx.getRates(base || "TJS", symbols);
  }

  @Get("convert")
  convert(
    @Query("amount") amount: string,
    @Query("from") fromCurrency: string,
    @Query("to") toCurrency: string,
  ) {
    return this.fx.convertMoney({
      amount,
      fromCurrency: fromCurrency || "TJS",
      toCurrency: toCurrency || "TJS",
    });
  }
}
