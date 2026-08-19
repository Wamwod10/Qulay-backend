import assert from "node:assert/strict";
import test from "node:test";

import { convertQuantity, normalizeUnit, parseQuantity, roundQuantity } from "../../src/common/utils/unit.util";

test("unit system converts weight without precision loss", () => {
  assert.equal(convertQuantity(1000, "g", "kg"), 1);
  assert.equal(convertQuantity(500, "g", "kg"), 0.5);
  assert.equal(convertQuantity(1.7, "kg", "g"), 1700);
});

test("unit system converts volume and length", () => {
  assert.equal(convertQuantity(1000, "ml", "litr"), 1);
  assert.equal(convertQuantity(100, "sm", "metr"), 1);
  assert.equal(convertQuantity(1000, "mm", "metr"), 1);
});

test("unit conversion rejects mixed dimensions and invalid quantities", () => {
  assert.throws(() => convertQuantity(1, "kg", "litr"), /UNIT_DIMENSION_MISMATCH|Har xil/);
  assert.throws(() => parseQuantity("-0.5"), /INVALID_QUANTITY|0 yoki/);
  assert.equal(normalizeUnit("cm"), "sm");
  assert.equal(roundQuantity(0.1234567), 0.123457);
});
