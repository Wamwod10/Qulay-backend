export declare const getPagination: (page?: number, limit?: number) => {
    page: number;
    limit: number;
    skip: number;
    take: number;
};
export declare const getPaginationMeta: (page: number, limit: number, total: number) => {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
};
