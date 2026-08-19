import { BadRequestException } from "@nestjs/common";

export type UnitDimension = "COUNT" | "WEIGHT" | "VOLUME" | "LENGTH";

export const UNIT_DEFINITIONS = {
  dona: { code: "dona", label: "dona", dimension: "COUNT", baseUnit: "dona", factor: 1 },
  g: { code: "g", label: "g", dimension: "WEIGHT", baseUnit: "g", factor: 1 },
  kg: { code: "kg", label: "kg", dimension: "WEIGHT", baseUnit: "g", factor: 1000 },
  ml: { code: "ml", label: "ml", dimension: "VOLUME", baseUnit: "ml", factor: 1 },
  litr: { code: "litr", label: "litr", dimension: "VOLUME", baseUnit: "ml", factor: 1000 },
  mm: { code: "mm", label: "mm", dimension: "LENGTH", baseUnit: "mm", factor: 1 },
  sm: { code: "sm", label: "sm", dimension: "LENGTH", baseUnit: "mm", factor: 10 },
  metr: { code: "metr", label: "metr", dimension: "LENGTH", baseUnit: "mm", factor: 1000 },
} as const;

const UNIT_ALIASES: Record<string, keyof typeof UNIT_DEFINITIONS> = {
  dona: "dona", piece: "dona", pcs: "dona", sht: "dona",
  g: "g", gram: "g", gramm: "g",
  kg: "kg", kilogram: "kg", kilogramm: "kg",
  ml: "ml", millilitr: "ml",
  litr: "litr", liter: "litr", l: "litr",
  mm: "mm", millimetr: "mm",
  sm: "sm", cm: "sm", santimetr: "sm",
  metr: "metr", m: "metr",
};

export const normalizeUnit = (value: unknown): keyof typeof UNIT_DEFINITIONS => {
  const key = String(value || "dona").trim().toLowerCase();
  const unit = UNIT_ALIASES[key];
  if (!unit) {
    throw new BadRequestException({ code: "INVALID_UNIT", message: `Noma'lum o'lchov birligi: ${value}.` });
  }
  return unit;
};

export const parseQuantity = (value: unknown, field = "Miqdor") => {
  if (value === null || value === undefined || value === "") {
    throw new BadRequestException({ code: "QUANTITY_REQUIRED", message: `${field} kiritilishi kerak.` });
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new BadRequestException({ code: "INVALID_QUANTITY", message: `${field} 0 yoki undan katta bo'lishi kerak.` });
  }
  return parsed;
};

export const roundQuantity = (value: unknown, precision = 6) => {
  const factor = 10 ** precision;
  return Math.round(parseQuantity(value) * factor) / factor;
};

export const convertQuantity = (value: unknown, from: unknown, to: unknown) => {
  const source = UNIT_DEFINITIONS[normalizeUnit(from)];
  const target = UNIT_DEFINITIONS[normalizeUnit(to)];
  if (source.dimension !== target.dimension) {
    throw new BadRequestException({ code: "UNIT_DIMENSION_MISMATCH", message: "Har xil o'lchov turidagi birliklarni aralashtirib bo'lmaydi." });
  }
  return parseQuantity(value) * source.factor / target.factor;
};

export const quantityToBase = (value: unknown, unit: unknown) => {
  const definition = UNIT_DEFINITIONS[normalizeUnit(unit)];
  return parseQuantity(value) * definition.factor;
};

export const getUnitDefinition = (unit: unknown) => UNIT_DEFINITIONS[normalizeUnit(unit)];

export const UNIT_OPTIONS = Object.values(UNIT_DEFINITIONS).map(({ code, label, dimension }) => ({ code, label, dimension }));
