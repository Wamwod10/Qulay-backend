import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TARGET_EMAIL = "shamshodochilov140@gmail.com";
const DEMO_SOURCE = "DEMO_COMPANY_SEED_V1";

const UNIT_DEFINITIONS = {
  dona: { dimension: "COUNT", factor: 1 },
  g: { dimension: "WEIGHT", factor: 1 },
  kg: { dimension: "WEIGHT", factor: 1000 },
  ml: { dimension: "VOLUME", factor: 1 },
  litr: { dimension: "VOLUME", factor: 1000 },
  mm: { dimension: "LENGTH", factor: 1 },
  sm: { dimension: "LENGTH", factor: 10 },
  metr: { dimension: "LENGTH", factor: 1000 },
} as const;

type CanonicalUnit = keyof typeof UNIT_DEFINITIONS;
type ProductType = "RAW_MATERIAL" | "SEMI_FINISHED" | "FINISHED_GOOD";
type SeedProduct = {
  key: string;
  name: string;
  sku: string;
  type: ProductType;
  unit: CanonicalUnit;
  category: string;
  cost: number;
  salePrice?: number | null;
  stock?: number;
  expiryMonths?: number;
  minimumStock?: number;
};
type RecipeMaterial = { productKey: string; quantity: number; unit: CanonicalUnit };
type SeedRecipe = {
  name: string;
  outputProductKey: string;
  outputQuantity: number;
  materials: RecipeMaterial[];
  normalWastePercent: number;
  overheadCost: number;
};
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const products: SeedProduct[] = [
  { key: "flour", name: "Un", sku: "DEMO-RAW-UN", type: "RAW_MATERIAL", unit: "kg", category: "Xomashyo", cost: 4.5, stock: 500, expiryMonths: 12, minimumStock: 80 },
  { key: "sugar", name: "Shakar", sku: "DEMO-RAW-SHAKAR", type: "RAW_MATERIAL", unit: "kg", category: "Xomashyo", cost: 7, stock: 300, expiryMonths: 18, minimumStock: 50 },
  { key: "salt", name: "Tuz", sku: "DEMO-RAW-TUZ", type: "RAW_MATERIAL", unit: "kg", category: "Xomashyo", cost: 1.5, stock: 100, expiryMonths: 24, minimumStock: 15 },
  { key: "cocoa", name: "Kakao", sku: "DEMO-RAW-KAKAO", type: "RAW_MATERIAL", unit: "kg", category: "Xomashyo", cost: 25, stock: 100, expiryMonths: 12, minimumStock: 20 },
  { key: "milk_powder", name: "Sut kukuni", sku: "DEMO-RAW-SUT-KUKUNI", type: "RAW_MATERIAL", unit: "kg", category: "Xomashyo", cost: 18, stock: 150, expiryMonths: 12, minimumStock: 25 },
  { key: "vegetable_oil", name: "O'simlik yog'i", sku: "DEMO-RAW-OSIMLIK-YOGI", type: "RAW_MATERIAL", unit: "litr", category: "Xomashyo", cost: 12, stock: 200, expiryMonths: 12, minimumStock: 30 },
  { key: "butter", name: "Sariyog'", sku: "DEMO-RAW-SARIYOG", type: "RAW_MATERIAL", unit: "kg", category: "Xomashyo", cost: 35, stock: 120, expiryMonths: 6, minimumStock: 20 },
  { key: "water", name: "Suv", sku: "DEMO-RAW-SUV", type: "RAW_MATERIAL", unit: "litr", category: "Xomashyo", cost: 0.2, stock: 1000, expiryMonths: 12, minimumStock: 100 },
  { key: "vanillin", name: "Vanilin", sku: "DEMO-RAW-VANILIN", type: "RAW_MATERIAL", unit: "kg", category: "Xomashyo", cost: 60, stock: 40, expiryMonths: 18, minimumStock: 5 },
  { key: "starch", name: "Kraxmal", sku: "DEMO-RAW-KRAXMAL", type: "RAW_MATERIAL", unit: "kg", category: "Xomashyo", cost: 6, stock: 150, expiryMonths: 18, minimumStock: 25 },
  { key: "egg_powder", name: "Tuxum kukuni", sku: "DEMO-RAW-TUXUM-KUKUNI", type: "RAW_MATERIAL", unit: "kg", category: "Xomashyo", cost: 28, stock: 80, expiryMonths: 10, minimumStock: 15 },
  { key: "dry_milk", name: "Quruq sut", sku: "DEMO-RAW-QURUQ-SUT", type: "RAW_MATERIAL", unit: "kg", category: "Xomashyo", cost: 20, stock: 120, expiryMonths: 12, minimumStock: 20 },
  { key: "chocolate", name: "Shokolad", sku: "DEMO-RAW-SHOKOLAD", type: "RAW_MATERIAL", unit: "kg", category: "Xomashyo", cost: 32, stock: 200, expiryMonths: 12, minimumStock: 30 },
  { key: "caramel", name: "Karamel", sku: "DEMO-RAW-KARAMEL", type: "RAW_MATERIAL", unit: "kg", category: "Xomashyo", cost: 15, stock: 150, expiryMonths: 9, minimumStock: 25 },
  { key: "walnut", name: "Yong'oq", sku: "DEMO-RAW-YONGOQ", type: "RAW_MATERIAL", unit: "kg", category: "Xomashyo", cost: 45, stock: 90, expiryMonths: 6, minimumStock: 12 },
  { key: "raisin", name: "Mayiz", sku: "DEMO-RAW-MAYIZ", type: "RAW_MATERIAL", unit: "kg", category: "Xomashyo", cost: 22, stock: 110, expiryMonths: 9, minimumStock: 15 },
  { key: "package", name: "Qadoqlash paketi", sku: "DEMO-RAW-QADOQ-PAKETI", type: "RAW_MATERIAL", unit: "dona", category: "Qadoqlash", cost: 0.5, stock: 3000, minimumStock: 500 },
  { key: "box", name: "Karton quti", sku: "DEMO-RAW-KARTON-QUTI", type: "RAW_MATERIAL", unit: "dona", category: "Qadoqlash", cost: 2.2, stock: 1000, minimumStock: 150 },
  { key: "label", name: "Etiketka", sku: "DEMO-RAW-ETIKETKA", type: "RAW_MATERIAL", unit: "dona", category: "Qadoqlash", cost: 0.15, stock: 5000, minimumStock: 800 },
  { key: "plastic_container", name: "Plastik idish", sku: "DEMO-RAW-PLASTIK-IDISH", type: "RAW_MATERIAL", unit: "dona", category: "Qadoqlash", cost: 1.8, stock: 1200, minimumStock: 200 },
  { key: "biscuit_base", name: "Biskvit asos", sku: "DEMO-SEMI-BISKVIT-ASOS", type: "SEMI_FINISHED", unit: "kg", category: "Yarim tayyor", cost: 12 },
  { key: "cream_base", name: "Krem asos", sku: "DEMO-SEMI-KREM-ASOS", type: "SEMI_FINISHED", unit: "kg", category: "Yarim tayyor", cost: 18 },
  { key: "wafer_sheet", name: "Vafli list", sku: "DEMO-SEMI-VAFLI-LIST", type: "SEMI_FINISHED", unit: "kg", category: "Yarim tayyor", cost: 15 },
  { key: "cookie", name: "Pechenye", sku: "DEMO-FG-PECHENYE", type: "FINISHED_GOOD", unit: "kg", category: "Tayyor mahsulot", cost: 15, salePrice: 28 },
  { key: "chocolate_cookie", name: "Shokoladli pechenye", sku: "DEMO-FG-SHOKOLADLI-PECHENYE", type: "FINISHED_GOOD", unit: "kg", category: "Tayyor mahsulot", cost: 18, salePrice: 35 },
  { key: "cream_cookie", name: "Kremli pechenye", sku: "DEMO-FG-KREMLI-PECHENYE", type: "FINISHED_GOOD", unit: "kg", category: "Tayyor mahsulot", cost: 20, salePrice: 38 },
  { key: "wafer", name: "Vafli", sku: "DEMO-FG-VAFLI", type: "FINISHED_GOOD", unit: "kg", category: "Tayyor mahsulot", cost: 17, salePrice: 32 },
  { key: "chocolate_bar", name: "Shokolad batonchasi", sku: "DEMO-FG-SHOKOLAD-BATON", type: "FINISHED_GOOD", unit: "kg", category: "Tayyor mahsulot", cost: 24, salePrice: 45 },
  { key: "caramel_bar", name: "Karamelli batonchasi", sku: "DEMO-FG-KARAMEL-BATON", type: "FINISHED_GOOD", unit: "kg", category: "Tayyor mahsulot", cost: 21, salePrice: 40 },
  { key: "sweet_mix", name: "Sweet Mix", sku: "DEMO-FG-SWEET-MIX", type: "FINISHED_GOOD", unit: "kg", category: "Tayyor mahsulot", cost: 22, salePrice: 42 },
];

const recipes: SeedRecipe[] = [
  {
    name: "Pechenye v1",
    outputProductKey: "cookie",
    outputQuantity: 20,
    normalWastePercent: 2,
    overheadCost: 35,
    materials: [
      { productKey: "flour", quantity: 10, unit: "kg" },
      { productKey: "sugar", quantity: 4, unit: "kg" },
      { productKey: "butter", quantity: 2, unit: "kg" },
      { productKey: "milk_powder", quantity: 1, unit: "kg" },
      { productKey: "egg_powder", quantity: 0.5, unit: "kg" },
      { productKey: "vanillin", quantity: 0.1, unit: "kg" },
      { productKey: "water", quantity: 2.4, unit: "litr" },
      { productKey: "package", quantity: 200, unit: "dona" },
    ],
  },
  {
    name: "Shokoladli pechenye v1",
    outputProductKey: "chocolate_cookie",
    outputQuantity: 20,
    normalWastePercent: 2.5,
    overheadCost: 42,
    materials: [
      { productKey: "flour", quantity: 9, unit: "kg" },
      { productKey: "sugar", quantity: 4, unit: "kg" },
      { productKey: "cocoa", quantity: 1.5, unit: "kg" },
      { productKey: "chocolate", quantity: 2, unit: "kg" },
      { productKey: "milk_powder", quantity: 1, unit: "kg" },
      { productKey: "vegetable_oil", quantity: 1.2, unit: "litr" },
      { productKey: "water", quantity: 1.3, unit: "litr" },
      { productKey: "package", quantity: 200, unit: "dona" },
    ],
  },
  {
    name: "Kremli pechenye v1",
    outputProductKey: "cream_cookie",
    outputQuantity: 20,
    normalWastePercent: 3,
    overheadCost: 45,
    materials: [
      { productKey: "flour", quantity: 8, unit: "kg" },
      { productKey: "sugar", quantity: 3, unit: "kg" },
      { productKey: "butter", quantity: 2.5, unit: "kg" },
      { productKey: "dry_milk", quantity: 1.5, unit: "kg" },
      { productKey: "starch", quantity: 1, unit: "kg" },
      { productKey: "vanillin", quantity: 0.15, unit: "kg" },
      { productKey: "water", quantity: 2.5, unit: "litr" },
      { productKey: "label", quantity: 180, unit: "dona" },
    ],
  },
  {
    name: "Vafli v1",
    outputProductKey: "wafer",
    outputQuantity: 15,
    normalWastePercent: 2,
    overheadCost: 32,
    materials: [
      { productKey: "flour", quantity: 6, unit: "kg" },
      { productKey: "sugar", quantity: 2, unit: "kg" },
      { productKey: "vegetable_oil", quantity: 2, unit: "litr" },
      { productKey: "milk_powder", quantity: 1, unit: "kg" },
      { productKey: "starch", quantity: 1.2, unit: "kg" },
      { productKey: "cocoa", quantity: 0.5, unit: "kg" },
      { productKey: "water", quantity: 2.5, unit: "litr" },
      { productKey: "box", quantity: 40, unit: "dona" },
    ],
  },
  {
    name: "Shokolad batonchasi v1",
    outputProductKey: "chocolate_bar",
    outputQuantity: 25,
    normalWastePercent: 1.5,
    overheadCost: 55,
    materials: [
      { productKey: "chocolate", quantity: 12, unit: "kg" },
      { productKey: "sugar", quantity: 8, unit: "kg" },
      { productKey: "cocoa", quantity: 2, unit: "kg" },
      { productKey: "caramel", quantity: 2, unit: "kg" },
      { productKey: "walnut", quantity: 1.5, unit: "kg" },
      { productKey: "raisin", quantity: 1, unit: "kg" },
      { productKey: "package", quantity: 250, unit: "dona" },
      { productKey: "label", quantity: 250, unit: "dona" },
    ],
  },
];

const normalizeUnit = (unit: CanonicalUnit | string): CanonicalUnit => {
  if (unit in UNIT_DEFINITIONS) return unit as CanonicalUnit;
  throw new Error(`Invalid unit: ${unit}`);
};

const decimalToNumber = (value: unknown) => {
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

const roundQuantity = (value: number, precision = 6) => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

const convertQuantity = (value: number, from: CanonicalUnit, to: CanonicalUnit) => {
  const source = UNIT_DEFINITIONS[normalizeUnit(from)];
  const target = UNIT_DEFINITIONS[normalizeUnit(to)];
  if (source.dimension !== target.dimension) {
    throw new Error(`Unit dimension mismatch: ${from} -> ${to}`);
  }
  return roundQuantity((value * source.factor) / target.factor);
};

const addMonths = (date: Date, months: number) => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
};

const resolveTargetCompany = async () => {
  const user = await prisma.user.findFirst({
    where: { email: { equals: TARGET_EMAIL, mode: "insensitive" }, deletedAt: null },
    include: {
      memberships: {
        include: { company: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!user) {
    throw new Error(`Target user not found by email: ${TARGET_EMAIL}`);
  }

  const membership = user.memberships.find((item) => item.company.status === "ACTIVE" && !item.company.deletedAt)
    || user.memberships[0];
  if (!membership?.company || membership.company.deletedAt) {
    throw new Error(`Target user has no active company membership: ${TARGET_EMAIL}`);
  }

  return { user, membership, company: membership.company };
};

const resolveDefaultWarehouse = async (companyId: string) => {
  const setting = await prisma.companySetting.findUnique({
    where: { companyId_key: { companyId, key: "platform" } },
    select: { value: true },
  });
  const settings = (setting?.value || {}) as any;
  const configuredIds = [
    settings?.defaults?.warehouseId,
    settings?.warehouse?.defaultWarehouseId,
    settings?.manufacturing?.defaultProductionWarehouseId,
    settings?.pos?.defaultWarehouseId,
  ].filter(Boolean);

  const configured = configuredIds.length
    ? await prisma.warehouse.findFirst({ where: { companyId, status: "ACTIVE", id: { in: configuredIds } } })
    : null;
  if (configured) return configured;

  const byCode = await prisma.warehouse.findFirst({ where: { companyId, status: "ACTIVE", code: "MAIN" }, orderBy: { createdAt: "asc" } });
  if (byCode) return byCode;

  const byName = await prisma.warehouse.findFirst({ where: { companyId, status: "ACTIVE", name: "Asosiy ombor" }, orderBy: { createdAt: "asc" } });
  if (byName) return byName;

  const firstActive = await prisma.warehouse.findFirst({ where: { companyId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  if (firstActive) return firstActive;

  return prisma.warehouse.create({ data: { companyId, name: "Asosiy ombor", code: "MAIN" } });
};

const ensureCategory = async (tx: Tx, companyId: string, name: string) => {
  const category = await tx.category.upsert({
    where: { companyId_name: { companyId, name } },
    update: { status: "ACTIVE" },
    create: { companyId, name, status: "ACTIVE" },
  });
  return category.id;
};

const findExistingProduct = async (tx: Tx, companyId: string, product: SeedProduct) => {
  return tx.product.findFirst({
    where: {
      companyId,
      deletedAt: null,
      OR: [
        { sku: product.sku },
        { name: { equals: product.name, mode: "insensitive" } },
      ],
    },
  });
};

const ensureProduct = async (tx: Tx, companyId: string, product: SeedProduct) => {
  const categoryId = await ensureCategory(tx, companyId, product.category);
  const existing = await findExistingProduct(tx, companyId, product);
  if (existing) {
    const isDemoSku = existing.sku === product.sku || existing.sku.startsWith("DEMO-");
    if (!isDemoSku) return { product: existing, created: false, updated: false, reusedByName: true };

    const updated = await tx.product.update({
      where: { id: existing.id },
      data: {
        name: product.name,
        sku: product.sku,
        type: product.type,
        category: product.category,
        categoryId,
        unit: product.unit,
        cost: product.cost,
        salePrice: product.salePrice ?? null,
        minimumStock: product.minimumStock ?? 0,
        status: "ACTIVE",
      },
    });
    return { product: updated, created: false, updated: true, reusedByName: false };
  }

  const created = await tx.product.create({
    data: {
      companyId,
      name: product.name,
      sku: product.sku,
      type: product.type,
      category: product.category,
      categoryId,
      unit: product.unit,
      stock: 0,
      minimumStock: product.minimumStock ?? 0,
      reorderPoint: product.minimumStock ?? 0,
      cost: product.cost,
      salePrice: product.salePrice ?? null,
      status: "ACTIVE",
    },
  });
  return { product: created, created: true, updated: false, reusedByName: false };
};

const ensureStockItem = async (tx: Tx, companyId: string, warehouseId: string, productId: string) => {
  return tx.stockItem.upsert({
    where: { companyId_warehouseId_productId: { companyId, warehouseId, productId } },
    update: {},
    create: { companyId, warehouseId, productId, quantity: 0, reserved: 0 },
  });
};

const refreshProductStock = async (tx: Tx, companyId: string, productId: string) => {
  const aggregate = await tx.stockItem.aggregate({ where: { companyId, productId }, _sum: { quantity: true } });
  await tx.product.update({ where: { id: productId, companyId }, data: { stock: decimalToNumber(aggregate._sum.quantity) } });
};

const ensureSeedStock = async (
  tx: Tx,
  companyId: string,
  warehouseId: string,
  product: Awaited<ReturnType<typeof ensureProduct>>["product"],
  quantity: number,
  expiryDate?: Date,
) => {
  const idempotencyKey = `${DEMO_SOURCE}:stock:${product.sku}`;
  const existingMovement = await tx.stockMovement.findUnique({
    where: { companyId_idempotencyKey: { companyId, idempotencyKey } },
  });
  if (existingMovement) {
    await ensureStockItem(tx, companyId, warehouseId, product.id);
    await refreshProductStock(tx, companyId, product.id);
    return { added: 0, batchCreated: false, movementCreated: false };
  }

  const batchNumber = `DEMO-${product.sku}`;
  const item = await ensureStockItem(tx, companyId, warehouseId, product.id);
  const batch = await tx.batch.upsert({
    where: { companyId_batchNumber_productId_warehouseId: { companyId, batchNumber, productId: product.id, warehouseId } },
    update: {
      status: "ACTIVE",
      productionDate: new Date(),
      receivedDate: new Date(),
      expiryDate: expiryDate ?? null,
      unitCost: decimalToNumber(product.cost),
    },
    create: {
      companyId,
      batchNumber,
      productId: product.id,
      warehouseId,
      quantity,
      remainingQuantity: quantity,
      productionDate: new Date(),
      receivedDate: new Date(),
      expiryDate: expiryDate ?? null,
      unitCost: decimalToNumber(product.cost),
      sourceType: DEMO_SOURCE,
      sourceId: product.sku,
      status: "ACTIVE",
    },
  });

  await tx.stockMovement.create({
    data: {
      companyId,
      warehouseId,
      productId: product.id,
      productName: product.name,
      type: "IN",
      quantity,
      unit: product.unit,
      cost: decimalToNumber(product.cost),
      reason: "DEMO_OPENING_STOCK",
      sourceType: DEMO_SOURCE,
      sourceId: product.sku,
      idempotencyKey,
      note: "QULAY ERP demo seed",
      batchId: batch.id,
    },
  });

  await tx.stockItem.update({
    where: { id: item.id },
    data: { quantity: { increment: quantity }, cost: decimalToNumber(product.cost) },
  });
  await refreshProductStock(tx, companyId, product.id);
  return { added: quantity, batchCreated: true, movementCreated: true };
};

const ensureRecipe = async (
  tx: Tx,
  companyId: string,
  recipe: SeedRecipe,
  productByKey: Map<string, Awaited<ReturnType<typeof ensureProduct>>["product"]>,
) => {
  const output = productByKey.get(recipe.outputProductKey);
  if (!output) throw new Error(`Output product not found for recipe: ${recipe.name}`);
  const materialData = recipe.materials.map((material) => {
    const product = productByKey.get(material.productKey);
    if (!product) throw new Error(`Material product not found for recipe ${recipe.name}: ${material.productKey}`);
    convertQuantity(material.quantity, material.unit, normalizeUnit(product.unit));
    return {
      productId: product.id,
      productName: product.name,
      quantity: material.quantity,
      unit: material.unit,
      cost: decimalToNumber(product.cost) * convertQuantity(1, material.unit, normalizeUnit(product.unit)),
    };
  });

  convertQuantity(recipe.outputQuantity, normalizeUnit(output.unit), normalizeUnit(output.unit));
  const existing = await tx.bom.findFirst({ where: { companyId, name: recipe.name }, orderBy: { createdAt: "asc" } });
  if (existing) {
    await tx.bomMaterial.deleteMany({ where: { bomId: existing.id } });
    const updated = await tx.bom.update({
      where: { id: existing.id },
      data: {
        outputProductId: output.id,
        outputProductName: output.name,
        outputQuantity: recipe.outputQuantity,
        unit: output.unit,
        overheadCost: recipe.overheadCost,
        status: "ACTIVE",
        version: 1,
        versionGroupId: existing.versionGroupId || existing.id,
        normalWastePercent: recipe.normalWastePercent,
        materials: { create: materialData },
      },
      include: { materials: true, outputProduct: true },
    });
    return { recipe: updated, created: false, updated: true };
  }

  const created = await tx.bom.create({
    data: {
      companyId,
      name: recipe.name,
      outputProductId: output.id,
      outputProductName: output.name,
      outputQuantity: recipe.outputQuantity,
      unit: output.unit,
      overheadCost: recipe.overheadCost,
      status: "ACTIVE",
      version: 1,
      normalWastePercent: recipe.normalWastePercent,
      materials: { create: materialData },
    },
    include: { materials: true, outputProduct: true },
  });
  const updated = await tx.bom.update({
    where: { id: created.id },
    data: { versionGroupId: created.id },
    include: { materials: true, outputProduct: true },
  });
  return { recipe: updated, created: true, updated: false };
};

const assertAvailability = async (
  companyId: string,
  warehouseId: string,
  productByKey: Map<string, Awaited<ReturnType<typeof ensureProduct>>["product"]>,
) => {
  const stockItems = await prisma.stockItem.findMany({
    where: { companyId, warehouseId },
    select: { productId: true, quantity: true, reserved: true },
  });
  const stockMap = new Map(stockItems.map((item) => [item.productId, decimalToNumber(item.quantity) - decimalToNumber(item.reserved)]));

  return recipes.map((recipe) => {
    const shortages = recipe.materials.map((material) => {
      const product = productByKey.get(material.productKey);
      if (!product) throw new Error(`Material product missing in availability check: ${material.productKey}`);
      const required = convertQuantity(material.quantity, material.unit, normalizeUnit(product.unit));
      const available = roundQuantity(stockMap.get(product.id) ?? 0);
      return {
        productName: product.name,
        required,
        available,
        unit: product.unit,
        enough: available >= required,
      };
    }).filter((item) => !item.enough);

    return { name: recipe.name, enough: shortages.length === 0, shortages };
  });
};

async function main() {
  const { user, membership, company } = await resolveTargetCompany();
  const warehouse = await resolveDefaultWarehouse(company.id);
  const now = new Date();
  const report = {
    targetCompany: { id: company.id, name: company.businessName || company.name, membershipRole: membership.role, userEmail: user.email },
    warehouse: { id: warehouse.id, name: warehouse.name, code: warehouse.code },
    productsCreated: 0,
    productsUpdated: 0,
    productsReusedByName: 0,
    stockAdded: 0,
    batchesCreated: 0,
    movementsCreated: 0,
    recipesCreated: 0,
    recipesUpdated: 0,
    productTypeCounts: {} as Record<ProductType, number>,
    recipes: [] as Array<{ name: string; output: string }>,
    availability: [] as Awaited<ReturnType<typeof assertAvailability>>,
    duplicates: { products: 0, recipes: 0 },
  };

  const productByKey = new Map<string, Awaited<ReturnType<typeof ensureProduct>>["product"]>();

  await prisma.$transaction(async (tx) => {
    for (const seedProduct of products) {
      const result = await ensureProduct(tx, company.id, seedProduct);
      productByKey.set(seedProduct.key, result.product);
      if (result.created) report.productsCreated += 1;
      if (result.updated) report.productsUpdated += 1;
      if (result.reusedByName) report.productsReusedByName += 1;
      report.productTypeCounts[seedProduct.type] = (report.productTypeCounts[seedProduct.type] || 0) + 1;

      if (seedProduct.type === "RAW_MATERIAL" && seedProduct.stock && seedProduct.stock > 0) {
        const stockResult = await ensureSeedStock(
          tx,
          company.id,
          warehouse.id,
          result.product,
          seedProduct.stock,
          seedProduct.expiryMonths ? addMonths(now, seedProduct.expiryMonths) : undefined,
        );
        report.stockAdded += stockResult.added;
        if (stockResult.batchCreated) report.batchesCreated += 1;
        if (stockResult.movementCreated) report.movementsCreated += 1;
      }
    }

    for (const recipe of recipes) {
      const result = await ensureRecipe(tx, company.id, recipe, productByKey);
      if (result.created) report.recipesCreated += 1;
      if (result.updated) report.recipesUpdated += 1;
      report.recipes.push({ name: result.recipe.name, output: `${decimalToNumber(result.recipe.outputQuantity)} ${result.recipe.unit}` });
    }
  }, { timeout: 60_000 });

  report.availability = await assertAvailability(company.id, warehouse.id, productByKey);

  const [demoProducts, activeRecipes, batchCount, stockCount] = await Promise.all([
    prisma.product.findMany({ where: { companyId: company.id, sku: { startsWith: "DEMO-" }, deletedAt: null }, select: { id: true, sku: true, name: true, type: true, unit: true } }),
    prisma.bom.findMany({ where: { companyId: company.id, name: { in: recipes.map((recipe) => recipe.name) }, status: "ACTIVE" }, include: { materials: true, outputProduct: true } }),
    prisma.batch.count({ where: { companyId: company.id, sourceType: DEMO_SOURCE, status: "ACTIVE" } }),
    prisma.stockItem.count({ where: { companyId: company.id, warehouseId: warehouse.id, quantity: { gt: 0 } } }),
  ]);
  const duplicateProductSkus = demoProducts.length - new Set(demoProducts.map((product) => product.sku)).size;
  const duplicateRecipeNames = activeRecipes.length - new Set(activeRecipes.map((recipe) => recipe.name)).size;
  report.duplicates = { products: duplicateProductSkus, recipes: duplicateRecipeNames };

  const missingAvailability = report.availability.filter((item) => !item.enough);
  if (demoProducts.length !== products.length) throw new Error(`Demo product count mismatch. Expected ${products.length}, got ${demoProducts.length}.`);
  if (activeRecipes.length !== recipes.length) throw new Error(`Active demo recipe count mismatch. Expected ${recipes.length}, got ${activeRecipes.length}.`);
  if (batchCount < products.filter((product) => product.type === "RAW_MATERIAL").length) throw new Error(`Demo batch count is too low: ${batchCount}.`);
  if (stockCount < products.filter((product) => product.type === "RAW_MATERIAL").length) throw new Error(`StockItem count is too low: ${stockCount}.`);
  if (missingAvailability.length) throw new Error(`Material availability failed: ${JSON.stringify(missingAvailability, null, 2)}`);
  if (duplicateProductSkus || duplicateRecipeNames) throw new Error(`Duplicate demo data detected: ${JSON.stringify(report.duplicates)}`);

  console.log(JSON.stringify(report, null, 2));
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
