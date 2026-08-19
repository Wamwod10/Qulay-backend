export const toNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : 0;
};

export const roundMoney = (value: unknown, precision = 2) => {
  const factor = 10 ** precision;
  const number = toNumber(value);
  if (!Number.isFinite(number)) return 0;
  return Number((Math.round((number + Number.EPSILON) * factor) / factor).toFixed(precision));
};

export const decimalToNumber = (value: unknown) => {
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }

  return toNumber(value);
};
