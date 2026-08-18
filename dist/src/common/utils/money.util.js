"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decimalToNumber = exports.roundMoney = exports.toNumber = void 0;
const toNumber = (value) => {
    if (value === null || value === undefined || value === "") {
        return 0;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
};
exports.toNumber = toNumber;
const roundMoney = (value, precision = 2) => {
    const factor = 10 ** precision;
    return Math.round((0, exports.toNumber)(value) * factor) / factor;
};
exports.roundMoney = roundMoney;
const decimalToNumber = (value) => {
    if (value && typeof value === "object" && "toNumber" in value) {
        return value.toNumber();
    }
    return (0, exports.toNumber)(value);
};
exports.decimalToNumber = decimalToNumber;
//# sourceMappingURL=money.util.js.map