export declare const PLATFORM_MODULES: readonly [{
    readonly key: "dashboard";
    readonly name: "Bosh sahifa";
    readonly locked: true;
}, {
    readonly key: "sales";
    readonly name: "Savdo";
    readonly locked: false;
}, {
    readonly key: "manufacturing";
    readonly name: "Ishlab chiqarish";
    readonly locked: false;
}, {
    readonly key: "warehouse";
    readonly name: "Ombor";
    readonly locked: false;
}, {
    readonly key: "purchases";
    readonly name: "Xaridlar";
    readonly locked: false;
}, {
    readonly key: "products";
    readonly name: "Mahsulotlar";
    readonly locked: false;
}, {
    readonly key: "customers";
    readonly name: "Mijozlar";
    readonly locked: false;
}, {
    readonly key: "agents";
    readonly name: "Agentlar";
    readonly locked: false;
}, {
    readonly key: "suppliers";
    readonly name: "Yetkazib beruvchilar";
    readonly locked: false;
}, {
    readonly key: "finance";
    readonly name: "Moliya";
    readonly locked: false;
}, {
    readonly key: "employees";
    readonly name: "Xodimlar";
    readonly locked: false;
}, {
    readonly key: "reports";
    readonly name: "Hisobotlar";
    readonly locked: false;
}, {
    readonly key: "settings";
    readonly name: "Sozlamalar";
    readonly locked: true;
}];
export type PlatformModuleKey = (typeof PLATFORM_MODULES)[number]["key"];
