"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startOfToday = exports.parseOptionalDate = void 0;
const parseOptionalDate = (value) => {
    if (!value) {
        return null;
    }
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
};
exports.parseOptionalDate = parseOptionalDate;
const startOfToday = () => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
};
exports.startOfToday = startOfToday;
//# sourceMappingURL=date.util.js.map