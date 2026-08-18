"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPaginationMeta = exports.getPagination = void 0;
const pagination_constants_1 = require("../constants/pagination.constants");
const getPagination = (page, limit) => {
    const safePage = Math.max(Number(page) || pagination_constants_1.DEFAULT_PAGE, 1);
    const safeLimit = Math.min(Math.max(Number(limit) || pagination_constants_1.DEFAULT_LIMIT, 1), pagination_constants_1.MAX_LIMIT);
    return {
        page: safePage,
        limit: safeLimit,
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
    };
};
exports.getPagination = getPagination;
const getPaginationMeta = (page, limit, total) => ({
    page,
    limit,
    total,
    totalPages: Math.max(Math.ceil(total / limit), 1),
});
exports.getPaginationMeta = getPaginationMeta;
//# sourceMappingURL=pagination.util.js.map