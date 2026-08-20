import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, SaleStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { ROLE_PERMISSION_MAP } from "../../common/constants/permissions.constants";
import { normalizeCurrency } from "../../common/utils/currency.util";
import { parseOptionalDate } from "../../common/utils/date.util";
import { decimalToNumber, roundMoney, toNumber } from "../../common/utils/money.util";
import { convertQuantity, normalizeUnit, parseQuantity, roundQuantity, UNIT_OPTIONS } from "../../common/utils/unit.util";
import { getPagination, getPaginationMeta } from "../../common/utils/pagination.util";
import { PrismaService } from "../../database/prisma.service";

type Tx = Prisma.TransactionClient;

const activeWhere = { deletedAt: null };

@Injectable()
export class BusinessService {
  constructor(private readonly prisma: PrismaService) {}

  requireCompany(companyId?: string | null) {
    if (!companyId || companyId === "platform") {
      throw new ForbiddenException({ code: "TENANT_REQUIRED", message: "Kompaniya tanlanmagan." });
    }

    return companyId;
  }

  async currentContext(user: any, companyId?: string | null) {
    const tenantId = this.requireCompany(companyId || user?.companyId);
    const company = await this.prisma.company.findFirst({ where: { id: tenantId, status: "ACTIVE", deletedAt: null } });

    if (!company) {
      throw new ForbiddenException({ code: "COMPANY_BLOCKED", message: "Kompaniya faol emas." });
    }

    return {
      user: {
        ...user,
        permissions: ROLE_PERMISSION_MAP[user?.role] || [],
      },
      company,
    };
  }

  async listProducts(companyId: string, query: Record<string, string | undefined>) {
    const tenantId = this.requireCompany(companyId);
    const { page, limit, skip, take } = getPagination(Number(query.page), Number(query.limit));
    const search = query.search?.trim();
    const where: any = { companyId: tenantId, deletedAt: null };

    if (query.status) where.status = query.status;
    if (query.category) where.category = query.category;
    if (query.type) where.type = query.type;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
        { barcode: { contains: search, mode: "insensitive" } },
      ];
    }

    const [total, products] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: { supplier: true, categoryRef: true, stockItems: true, batches: { where: { status: "ACTIVE", remainingQuantity: { gt: 0 } }, orderBy: { expiryDate: "asc" } } },
      }),
    ]);

    return { products: products.map(this.productDto), data: products.map(this.productDto), meta: getPaginationMeta(page, limit, total) };
  }

  async getProduct(companyId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, companyId: this.requireCompany(companyId), deletedAt: null },
      include: {
        supplier: true,
        categoryRef: true,
        stockItems: { include: { warehouse: true } },
        batches: { include: { warehouse: true }, orderBy: { createdAt: "desc" } },
        movements: { orderBy: { createdAt: "desc" }, take: 25 },
      },
    });

    if (!product) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: "Mahsulot topilmadi." });

    return {
      ...this.productDto(product),
      stockItems: product.stockItems.map(this.stockDto),
      history: product.movements.map(this.movementDto),
    };
  }

  async createProduct(companyId: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const sku = String(body.sku || (await this.generateSku(tenantId))).trim();
    const name = String(body.name || "").trim();
    if (!name) throw new BadRequestException({ code: "PRODUCT_NAME_REQUIRED", message: "Mahsulot nomini kiriting." });
    if (!String(body.type || "").trim()) throw new BadRequestException({ code: "PRODUCT_TYPE_REQUIRED", message: "Mahsulot turini tanlang." });
    const stock = parseQuantity(body.stock ?? 0, "Boshlang'ich qoldiq");
    const warehouse = body.warehouseId
      ? await this.prisma.warehouse.findFirst({ where: { id: body.warehouseId, companyId: tenantId, status: "ACTIVE" } })
      : null;
    if (body.warehouseId && !warehouse) throw new NotFoundException({ code: "WAREHOUSE_NOT_FOUND", message: "Ombor topilmadi." });
    if (body.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({ where: { id: body.supplierId, companyId: tenantId, deletedAt: null } });
      if (!supplier) throw new NotFoundException({ code: "SUPPLIER_NOT_FOUND", message: "Yetkazib beruvchi topilmadi." });
    }

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          companyId: tenantId,
          name,
          sku,
          barcode: body.barcode || null,
          type: body.type || null,
          category: body.category || null,
          categoryId: await this.ensureCategory(tx, tenantId, body.categoryId || body.category),
          brand: body.brand || null,
          unit: normalizeUnit(body.unit),
          stock: 0,
          minimumStock: body.minimumStock === undefined || body.minimumStock === "" ? 0 : parseQuantity(body.minimumStock, "Minimal qoldiq"),
          reorderPoint: body.reorderPoint === undefined || body.reorderPoint === "" ? 0 : parseQuantity(body.reorderPoint, "Qayta buyurtma nuqtasi"),
          cost: roundMoney(body.cost),
          salePrice: body.salePrice === null || body.salePrice === "" || body.salePrice === undefined ? null : roundMoney(body.salePrice),
          tax: roundMoney(body.tax),
          discount: roundMoney(body.discount),
          image: body.image || null,
          notes: body.notes || null,
          expiryDate: body.expiryDate ? parseOptionalDate(body.expiryDate) : null,
          normalWastePercent: body.normalWastePercent === undefined || body.normalWastePercent === "" ? null : toNumber(body.normalWastePercent),
          parentProductId: body.parentProductId || null,
          packSize: body.packSize === undefined || body.packSize === "" ? null : parseQuantity(body.packSize, "Qadoq hajmi"),
          packUnit: body.packUnit || null,
          isVariant: Boolean(body.isVariant || body.parentProductId),
          supplierId: body.supplierId || null,
          status: body.status || "ACTIVE",
        },
      });

      if (stock > 0 && warehouse) {
        await this.adjustStockDelta(tx, tenantId, warehouse.id, product.id, stock, {
          type: "IN",
          reason: "OPENING_STOCK",
          sourceType: "PRODUCT",
          sourceId: product.id,
          cost: product.cost,
        });
      }

      if (stock > 0 && warehouse) await this.refreshProductStock(tx, tenantId, product.id);

      return this.productDto({ ...product, stock: warehouse ? stock : 0 });
    });
  }

  async updateProduct(companyId: string, id: string, body: any, actorUserId?: string) {
    const tenantId = this.requireCompany(companyId);
    const currentProduct = await this.prisma.product.findFirst({
      where: { id, companyId: tenantId, deletedAt: null },
      include: { stockItems: true },
    });
    if (!currentProduct) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: "Mahsulot topilmadi." });
    if (body.name !== undefined && !String(body.name || "").trim()) {
      throw new BadRequestException({ code: "PRODUCT_NAME_REQUIRED", message: "Mahsulot nomini kiriting." });
    }
    const categoryInput = body.categoryId || (body.category !== undefined ? body.category : undefined);
    const categoryId = categoryInput === undefined
      ? undefined
      : await this.ensureCategory(this.prisma, tenantId, categoryInput);
    const categoryRecord = categoryId
      ? await this.prisma.category.findFirst({ where: { id: categoryId, companyId: tenantId } })
      : null;
    const categoryName = body.category === undefined
      ? categoryRecord?.name
      : categoryRecord?.name || body.category || null;
    const nextUnit = body.unit === undefined ? currentProduct.unit : normalizeUnit(body.unit);
    if (nextUnit !== currentProduct.unit) {
      const stockQuantity = currentProduct.stockItems.reduce((sum, item) => sum + toNumber(item.quantity), 0);
      const [movementCount, purchaseCount, saleCount, bomCount, productionCount] = await Promise.all([
        this.prisma.stockMovement.count({ where: { companyId: tenantId, productId: id } }),
        this.prisma.purchaseItem.count({ where: { productId: id } }),
        this.prisma.saleItem.count({ where: { productId: id } }),
        this.prisma.bomMaterial.count({ where: { productId: id } }),
        this.prisma.productionOrder.count({ where: { companyId: tenantId, outputProductId: id } }),
      ]);
      if (stockQuantity > 0 || movementCount || purchaseCount || saleCount || bomCount || productionCount) {
        throw new ConflictException({
          code: "UNIT_CHANGE_BLOCKED",
          message: "Qoldiq yoki tarix mavjud mahsulotning o'lchov birligini o'zgartirib bo'lmaydi. Avval yangi mahsulot yarating.",
        });
      }
    }
    if (body.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({ where: { id: body.supplierId, companyId: tenantId, deletedAt: null } });
      if (!supplier) throw new NotFoundException({ code: "SUPPLIER_NOT_FOUND", message: "Yetkazib beruvchi topilmadi." });
    }

    const updated = await this.prisma.product.update({
      where: { id, companyId: tenantId },
      data: {
        name: body.name,
        sku: body.sku,
        barcode: body.barcode,
        type: body.type,
        category: categoryName,
        categoryId,
        brand: body.brand,
        unit: body.unit === undefined ? undefined : nextUnit,
        minimumStock: body.minimumStock === undefined ? undefined : body.minimumStock === null || body.minimumStock === "" ? 0 : parseQuantity(body.minimumStock, "Minimal qoldiq"),
        reorderPoint: body.reorderPoint === undefined ? undefined : body.reorderPoint === null || body.reorderPoint === "" ? 0 : parseQuantity(body.reorderPoint, "Qayta buyurtma nuqtasi"),
        cost: body.cost === undefined ? undefined : roundMoney(body.cost),
        salePrice: body.salePrice === undefined ? undefined : body.salePrice === null || body.salePrice === "" ? null : roundMoney(body.salePrice),
        tax: body.tax === undefined ? undefined : roundMoney(body.tax),
        discount: body.discount === undefined ? undefined : roundMoney(body.discount),
        image: body.image,
        notes: body.notes,
        expiryDate: body.expiryDate === undefined ? undefined : body.expiryDate ? parseOptionalDate(body.expiryDate) : null,
        normalWastePercent: body.normalWastePercent === undefined ? undefined : body.normalWastePercent === null || body.normalWastePercent === "" ? null : toNumber(body.normalWastePercent),
        parentProductId: body.parentProductId,
        packSize: body.packSize === undefined ? undefined : body.packSize === null || body.packSize === "" ? null : parseQuantity(body.packSize, "Qadoq hajmi"),
        packUnit: body.packUnit,
        isVariant: body.isVariant,
        supplierId: body.supplierId,
        status: body.status,
      },
    });
    if (body.cost !== undefined || body.salePrice !== undefined) {
      await this.writeAudit(this.prisma, tenantId, actorUserId, "product.price_change", "product", id, { before: { cost: currentProduct.cost, salePrice: currentProduct.salePrice }, after: { cost: body.cost, salePrice: body.salePrice } });
    }

    return this.productDto(updated);
  }

  async changeProductStatus(companyId: string, id: string, status: "ACTIVE" | "INACTIVE" | "ARCHIVED") {
    await this.getProduct(companyId, id);
    const updated = await this.prisma.product.update({ where: { id, companyId: this.requireCompany(companyId) }, data: { status } });

    return this.productDto(updated);
  }

  async deleteProduct(companyId: string, id: string) {
    await this.getProduct(companyId, id);
    const [saleCount, purchaseCount, movementCount, batchCount, bomCount, productionCount] = await Promise.all([
      this.prisma.saleItem.count({ where: { productId: id } }),
      this.prisma.purchaseItem.count({ where: { productId: id } }),
      this.prisma.stockMovement.count({ where: { productId: id } }),
      this.prisma.batch.count({ where: { productId: id } }),
      this.prisma.bomMaterial.count({ where: { productId: id } }),
      this.prisma.productionOrder.count({ where: { companyId: this.requireCompany(companyId), outputProductId: id } }),
    ]);
    const historical = saleCount + purchaseCount + movementCount + batchCount + bomCount + productionCount;

    if (historical > 0) {
      await this.prisma.product.update({ where: { id, companyId: this.requireCompany(companyId) }, data: { status: "ARCHIVED", deletedAt: new Date() } });

      return { deleted: true, softDelete: true };
    }

    await this.prisma.product.delete({ where: { id, companyId: this.requireCompany(companyId) } });

    return { deleted: true, softDelete: false };
  }

  async duplicateProduct(companyId: string, id: string) {
    const product = await this.getProduct(companyId, id);

    return this.createProduct(companyId, {
      ...product,
      id: undefined,
      name: `${product.name} - nusxa`,
      sku: await this.generateSku(companyId),
      barcode: "",
      stock: 0,
    });
  }

  async adjustProductStock(companyId: string, id: string, body: any, actorUserId?: string) {
    const tenantId = this.requireCompany(companyId);
    await this.getProduct(tenantId, id);
    const warehouseId = body.warehouseId || (await this.ensureDefaultWarehouse(tenantId)).id;
    const newStock = parseQuantity(body.newStock ?? body.quantity, "Qoldiq");

    if (newStock < 0) throw new BadRequestException({ code: "NEGATIVE_STOCK", message: "Qoldiq manfiy bo'lmasin." });

    return this.prisma.$transaction(async (tx) => {
      await this.requireWarehouse(tx, tenantId, warehouseId);
      const item = await this.ensureStockItem(tx, tenantId, warehouseId, id);
      const oldQuantity = toNumber(item.quantity);
      const delta = roundQuantity(newStock - oldQuantity);
      if (delta !== 0) {
        await this.adjustStockDelta(tx, tenantId, warehouseId, id, delta, {
          type: "INVENTORY_ADJUSTMENT",
          reason: body.reason || "MANUAL_ADJUSTMENT",
          note: body.note,
          sourceType: "PRODUCT",
          sourceId: id,
          idempotencyKey: body.idempotencyKey,
          cost: body.cost,
        });
      }
      await this.writeAudit(tx, tenantId, actorUserId, "stock.adjustment", "product", id, { before: oldQuantity, after: newStock, reason: body.reason || null });

      return this.getProduct(tenantId, id);
    });
  }

  async updateProductPrices(companyId: string, id: string, body: any, actorUserId?: string) {
    return this.updateProduct(companyId, id, { cost: body.cost, salePrice: body.salePrice }, actorUserId);
  }

  async listWarehouses(companyId: string) {
    const warehouses = await this.prisma.warehouse.findMany({
      where: { companyId: this.requireCompany(companyId) },
      orderBy: { createdAt: "asc" },
    });

    return { warehouses, data: warehouses };
  }

  async createWarehouse(companyId: string, body: any) {
    const warehouse = await this.prisma.warehouse.create({
      data: {
        companyId: this.requireCompany(companyId),
        name: body.name,
        code: body.code,
        address: body.address,
        status: body.status || "ACTIVE",
      },
    });

    return warehouse;
  }

  async listUnits() {
    return { units: UNIT_OPTIONS, data: UNIT_OPTIONS };
  }

  async listCategories(companyId: string) {
    const categories = await this.prisma.category.findMany({
      where: { companyId: this.requireCompany(companyId), status: "ACTIVE" },
      orderBy: { name: "asc" },
    });
    return { categories, data: categories };
  }

async createCategory(companyId: string, body: any) {
  const name = String(body.name || "").trim();

  if (!name) {
    throw new BadRequestException({
      code: "CATEGORY_NAME_REQUIRED",
      message: "Kategoriya nomini kiriting.",
    });
  }

  const tenantId = this.requireCompany(companyId);

  const existing = await this.prisma.category.findFirst({
    where: {
      companyId: tenantId,
      name: {
        equals: name,
        mode: "insensitive",
      },
    },
  });

  if (existing) {
    return this.prisma.category.update({
      where: { id: existing.id },
      data: { status: "ACTIVE" },
    });
  }

  return this.prisma.category.create({
    data: {
      companyId: tenantId,
      name,
      status: "ACTIVE",
    },
  });
}

  async listStock(companyId: string, query: Record<string, string | undefined>) {
    const tenantId = this.requireCompany(companyId);
    const stock = await this.prisma.stockItem.findMany({
      where: {
        companyId: tenantId,
        warehouseId: query.warehouseId || undefined,
        productId: query.productId || undefined,
      },
      include: { product: { include: { batches: { where: { status: "ACTIVE", remainingQuantity: { gt: 0 } }, orderBy: { expiryDate: "asc" } } } }, warehouse: true },
      orderBy: { updatedAt: "desc" },
    });

    const rows = stock.map(this.stockDto);
    return { stock: rows, data: rows, warnings: rows.filter((item: any) => item.isLowStock || item.expiryStatus) };
  }

  async listBatches(companyId: string, query: Record<string, string | undefined> = {}) {
    const tenantId = this.requireCompany(companyId);
    const batches = await this.prisma.batch.findMany({
      where: { companyId: tenantId, productId: query.productId || undefined, warehouseId: query.warehouseId || undefined, status: "ACTIVE", remainingQuantity: { gt: 0 } },
      include: { product: true, warehouse: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return { batches: batches.map(this.batchDto), data: batches.map(this.batchDto) };
  }

  async batchWarnings(companyId: string, query: Record<string, string | undefined> = {}) {
    const result = await this.listBatches(companyId, query);
    const now = Date.now();
    const days = Number(query.days || 30);
    return {
      ...result,
      warnings: result.batches.filter((batch: any) => batch.expiryDate && new Date(batch.expiryDate).getTime() <= now + days * 86_400_000),
    };
  }

  async stockIn(companyId: string, body: any) {
    return this.changeStock(companyId, {
      ...body,
      type: "IN",
      quantity: parseQuantity(body.quantity),
      reason: body.source || body.reason || "MANUAL_IN",
    });
  }

  async stockOut(companyId: string, body: any) {
    return this.changeStock(companyId, {
      ...body,
      type: "OUT",
      quantity: -parseQuantity(body.quantity),
      reason: body.reason || "MANUAL_OUT",
    });
  }

  async transferStock(companyId: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const amount = parseQuantity(body.quantity);
    const transferKey = body.idempotencyKey || `transfer:${body.fromWarehouseId}:${body.toWarehouseId}:${body.productId}:${Date.now()}`;

    if (!amount || amount <= 0) throw new BadRequestException({ code: "INVALID_QUANTITY", message: "Miqdor 0 dan katta bo'lsin." });
    if (body.fromWarehouseId === body.toWarehouseId) throw new BadRequestException({ code: "SAME_WAREHOUSE", message: "Omborlar bir xil bo'lmasin." });

    return this.prisma.$transaction(async (tx) => {
      if (body.idempotencyKey) {
        const existing = await tx.stockMovement.findUnique({
          where: { companyId_idempotencyKey: { companyId: tenantId, idempotencyKey: `${transferKey}:out` } },
        });
        if (existing) return this.listStock(tenantId, {});
      }
      await this.adjustStockDelta(tx, tenantId, body.fromWarehouseId, body.productId, -amount, {
        type: "TRANSFER_OUT",
        reason: "TRANSFER",
        sourceType: "TRANSFER",
        sourceId: transferKey,
        idempotencyKey: `${transferKey}:out`,
        note: body.note,
        destinationWarehouseId: body.toWarehouseId,
      });
      await this.adjustStockDelta(tx, tenantId, body.toWarehouseId, body.productId, amount, {
        type: "TRANSFER_IN",
        reason: "TRANSFER",
        sourceType: "TRANSFER",
        sourceId: transferKey,
        idempotencyKey: `${transferKey}:in`,
        note: body.note,
        sourceWarehouseId: body.fromWarehouseId,
      });

      return this.listStock(tenantId, {});
    });
  }

  async listMovements(companyId: string, query: Record<string, string | undefined>) {
    const movements = await this.prisma.stockMovement.findMany({
      where: {
        companyId: this.requireCompany(companyId),
        warehouseId: query.warehouseId || undefined,
        productId: query.productId || undefined,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return { movements: movements.map(this.movementDto), data: movements.map(this.movementDto) };
  }

  async listInventoryCounts(companyId: string, query: Record<string, string | undefined> = {}) {
    const counts = await this.prisma.inventoryCount.findMany({
      where: { companyId: this.requireCompany(companyId), warehouseId: query.warehouseId || undefined, productId: query.productId || undefined },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    return { counts: counts.map(this.inventoryCountDto), data: counts.map(this.inventoryCountDto) };
  }

  async createInventoryCount(companyId: string, body: any, actorUserId?: string) {
    const tenantId = this.requireCompany(companyId);
    const actualQuantity = parseQuantity(body.actualQuantity, "Haqiqiy qoldiq");
    if (actualQuantity < 0) throw new BadRequestException({ code: "NEGATIVE_INVENTORY_COUNT", message: "Inventarizatsiya qoldig'i manfiy bo'lmasin." });
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({ where: { id: body.productId, companyId: tenantId, deletedAt: null } });
      if (!product) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: "Mahsulot topilmadi." });
      await this.requireWarehouse(tx, tenantId, body.warehouseId);
      const item = await this.ensureStockItem(tx, tenantId, body.warehouseId, body.productId);
      const systemQuantity = toNumber(item.quantity);
      const difference = roundQuantity(actualQuantity - systemQuantity);
      const count = await tx.inventoryCount.create({
        data: {
          companyId: tenantId,
          warehouseId: body.warehouseId,
          productId: body.productId,
          systemQuantity,
          actualQuantity,
          difference,
          reason: String(body.reason || "Inventarizatsiya").trim(),
          approvedBy: actorUserId || body.approvedBy || null,
        },
      });
      if (difference !== 0) {
        await this.adjustStockDelta(tx, tenantId, body.warehouseId, body.productId, difference, {
          type: "INVENTORY_ADJUSTMENT",
          reason: "INVENTORY_COUNT",
          sourceType: "INVENTORY_COUNT",
          sourceId: count.id,
          idempotencyKey: `inventory-count:${count.id}`,
          note: count.reason,
          actorUserId,
        });
        await tx.inventoryCount.update({ where: { id: count.id }, data: { adjustmentId: count.id } });
      }
      await this.writeAudit(tx, tenantId, actorUserId, "stock.adjustment", "inventory_count", count.id, { before: systemQuantity, after: actualQuantity, difference, reason: count.reason });
      return this.inventoryCountDto({ ...count, adjustmentId: difference !== 0 ? count.id : null });
    });
  }

  async purchaseSuggestions(companyId: string, query: Record<string, string | undefined> = {}) {
    const tenantId = this.requireCompany(companyId);
    const products = await this.prisma.product.findMany({ where: { companyId: tenantId, deletedAt: null, status: "ACTIVE", id: query.productId || undefined }, include: { stockItems: true, supplier: true } });
    const suggestions = products.map((product) => {
      const available = product.stockItems.reduce((sum, item) => sum + toNumber(item.quantity) - toNumber(item.reserved), 0);
      const target = Math.max(toNumber(product.reorderPoint), toNumber(product.minimumStock));
      return { productId: product.id, productName: product.name, unit: product.unit, available: roundQuantity(Math.max(available, 0)), target: roundQuantity(target), required: roundQuantity(Math.max(target - available, 0)), supplierId: product.supplierId, supplierName: product.supplier?.name || null };
    }).filter((item) => item.required > 0);
    return { suggestions, data: suggestions };
  }

  async listSupplierPriceHistory(companyId: string, query: Record<string, string | undefined> = {}) {
    const history = await this.prisma.supplierPriceHistory.findMany({
      where: { companyId: this.requireCompany(companyId), productId: query.productId || undefined, supplierId: query.supplierId || undefined },
      include: { supplier: true, product: true },
      orderBy: { date: "desc" },
      take: 500,
    });
    return { history: history.map(this.supplierPriceDto), data: history.map(this.supplierPriceDto) };
  }

  async listSuppliers(companyId: string, query: Record<string, string | undefined>) {
    const where: any = { companyId: this.requireCompany(companyId), deletedAt: null };
    const search = query.search?.trim();

    if (query.status) where.status = query.status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { companyName: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }

    const suppliers = await this.prisma.supplier.findMany({ where, orderBy: { createdAt: "desc" } });

    return { suppliers: suppliers.map(this.supplierDto), data: suppliers.map(this.supplierDto) };
  }

  async getSupplier(companyId: string, id: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, companyId: this.requireCompany(companyId), deletedAt: null },
      include: { purchases: { orderBy: { createdAt: "desc" }, take: 20 }, products: true },
    });

    if (!supplier) throw new NotFoundException({ code: "SUPPLIER_NOT_FOUND", message: "Yetkazib beruvchi topilmadi." });

    return {
      ...this.supplierDto(supplier),
      purchases: supplier.purchases.map(this.purchaseDto),
      products: supplier.products.map(this.productDto),
    };
  }

  async createSupplier(companyId: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const name = String(body.name || body.companyName || "").trim();
    if (!name) throw new BadRequestException({ code: "SUPPLIER_NAME_REQUIRED", message: "Yetkazib beruvchi nomini kiriting.", field: "name" });
    const existing = await this.prisma.supplier.findFirst({
      where: { companyId: tenantId, deletedAt: null, name: { equals: name, mode: "insensitive" } },
    });
    if (existing) throw new ConflictException({ code: "SUPPLIER_EXISTS", message: "Bu qiymat allaqachon mavjud.", field: "name" });
    const supplier = await this.prisma.supplier.create({
      data: {
        companyId: tenantId,
        name,
        companyName: body.companyName,
        contactPerson: body.contactPerson,
        phone: body.phone,
        email: body.email,
        address: body.address,
        notes: body.notes,
        status: body.status || "ACTIVE",
      },
    });

    return this.supplierDto(supplier);
  }

  async updateSupplier(companyId: string, id: string, body: any) {
    await this.getSupplier(companyId, id);
    const supplier = await this.prisma.supplier.update({
      where: { id, companyId: this.requireCompany(companyId) },
      data: {
        name: body.name,
        companyName: body.companyName,
        contactPerson: body.contactPerson,
        phone: body.phone,
        email: body.email,
        address: body.address,
        notes: body.notes,
        status: body.status,
      },
    });

    return this.supplierDto(supplier);
  }

  async deleteSupplier(companyId: string, id: string) {
    await this.getSupplier(companyId, id);
    const [purchases, history] = await Promise.all([
      this.prisma.purchase.count({ where: { supplierId: id } }),
      this.prisma.supplierPriceHistory.count({ where: { supplierId: id } }),
    ]);

    if (purchases > 0 || history > 0) {
      await this.prisma.supplier.update({ where: { id, companyId: this.requireCompany(companyId) }, data: { status: "INACTIVE", deletedAt: new Date() } });

      return { deleted: true, softDelete: true };
    }

    await this.prisma.supplier.delete({ where: { id, companyId: this.requireCompany(companyId) } });

    return { deleted: true, softDelete: false };
  }

  async listPurchases(companyId: string, query: Record<string, string | undefined>) {
    const where: any = { companyId: this.requireCompany(companyId) };
    const search = query.search?.trim();

    if (query.status) where.status = query.status;
    if (query.supplierId) where.supplierId = query.supplierId;
    if (search) {
      where.OR = [
        { number: { contains: search, mode: "insensitive" } },
        { supplierName: { contains: search, mode: "insensitive" } },
        { warehouseName: { contains: search, mode: "insensitive" } },
      ];
    }

    const purchases = await this.prisma.purchase.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return { purchases: purchases.map(this.purchaseDto), data: purchases.map(this.purchaseDto) };
  }

  async getPurchase(companyId: string, id: string) {
    const purchase = await this.prisma.purchase.findFirst({
      where: { id, companyId: this.requireCompany(companyId) },
      include: { items: true, supplier: true, warehouse: true },
    });

    if (!purchase) throw new NotFoundException({ code: "PURCHASE_NOT_FOUND", message: "Xarid topilmadi." });

    return this.purchaseDto(purchase);
  }

  async createPurchase(companyId: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const productIds = Array.from(new Set<string>((body.items || []).map((item: any) => item.productId).filter(Boolean)));
    const productRecords = await this.prisma.product.findMany({ where: { companyId: tenantId, id: { in: productIds }, deletedAt: null } });
    await this.validateProductIds(this.prisma, tenantId, productIds);
    const items = this.normalizePurchaseItems(body.items || [], new Map(productRecords.map((product) => [product.id, product])));
    const total = roundMoney(items.reduce((sum, item) => sum + item.subtotal, 0));
    const paidAmount = roundMoney(body.paidAmount || body.payments?.reduce((sum: number, payment: any) => sum + toNumber(payment.amount), 0));
    // A purchase order is not supplier debt until goods are received.
    // The liability is posted from received quantities in receivePurchase().
    const debtAmount = 0;
    const supplier = body.supplierId ? await this.prisma.supplier.findFirst({ where: { id: body.supplierId, companyId: tenantId, deletedAt: null } }) : null;
    if (body.supplierId && !supplier) throw new NotFoundException({ code: "SUPPLIER_NOT_FOUND", message: "Yetkazib beruvchi topilmadi." });
    const warehouse = body.warehouseId ? await this.prisma.warehouse.findFirst({ where: { id: body.warehouseId, companyId: tenantId } }) : await this.ensureDefaultWarehouse(tenantId);
    if (body.warehouseId && !warehouse) throw new NotFoundException({ code: "WAREHOUSE_NOT_FOUND", message: "Ombor topilmadi." });
    if (paidAmount > total) throw new BadRequestException({ code: "OVERPAYMENT", message: "To'lov jami summadan oshmasin." });
    const purchase = await this.prisma.$transaction(async (tx) => {
      const created = await tx.purchase.create({
        data: {
          companyId: tenantId,
          number: body.number || (await this.generateNumber(tx, tenantId, "purchase")),
          supplierId: supplier?.id || null,
          supplierName: body.supplierName || supplier?.name || null,
          warehouseId: warehouse?.id || null,
          warehouseName: body.warehouseName || warehouse?.name || null,
          status: body.status || "ORDERED",
          subtotal: total,
          total,
          paidAmount,
          debtAmount,
          expectedDate: parseOptionalDate(body.expectedDate),
          orderDate: parseOptionalDate(body.orderDate) || new Date(),
          note: body.note,
          items: {
            create: items.map((item) => ({
              productId: item.productId,
              productName: item.productName,
              sku: item.sku,
              quantity: item.quantity,
              purchaseQuantity: item.purchaseQuantity,
              unit: item.unit,
              purchaseUnit: item.purchaseUnit,
              cost: item.cost,
              salePrice: item.salePrice,
              subtotal: item.subtotal,
            })),
          },
        },
        include: { items: true },
      });

      if (paidAmount > 0) {
        await this.createFinanceTx(tx, tenantId, {
          type: "OUT",
          amount: paidAmount,
          category: "SUPPLIER_PAYMENT",
          sourceType: "PURCHASE",
          sourceId: created.id,
          idempotencyKey: `purchase-payment:${created.id}:initial`,
          purchaseId: created.id,
          supplierId: supplier?.id,
          method: body.paymentMethod || body.payments?.[0]?.method || "CASH",
          description: `Purchase ${created.number}`,
        });
      }

      return created;
    });

    return this.purchaseDto(purchase);
  }

  async updatePurchase(companyId: string, id: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const existing = await this.getPurchase(companyId, id);

    if (["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"].includes(existing.status)) {
      throw new ConflictException({ code: "PURCHASE_LOCKED", message: "Qabul qilingan/bekor qilingan xarid tahrirlanmaydi." });
    }

    const itemProductIds = body.items ? Array.from(new Set<string>(body.items.map((item: any) => item.productId).filter(Boolean))) : [];
    const itemProducts = body.items ? await this.prisma.product.findMany({ where: { companyId: tenantId, id: { in: itemProductIds }, deletedAt: null } }) : [];
    const items = body.items ? this.normalizePurchaseItems(body.items, new Map(itemProducts.map((product) => [product.id, product]))) : null;
    const total = items ? roundMoney(items.reduce((sum, item) => sum + item.subtotal, 0)) : undefined;
    if (body.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({ where: { id: body.supplierId, companyId: tenantId, deletedAt: null } });
      if (!supplier) throw new NotFoundException({ code: "SUPPLIER_NOT_FOUND", message: "Yetkazib beruvchi topilmadi." });
    }
    if (body.warehouseId) {
      const warehouse = await this.prisma.warehouse.findFirst({ where: { id: body.warehouseId, companyId: tenantId } });
      if (!warehouse) throw new NotFoundException({ code: "WAREHOUSE_NOT_FOUND", message: "Ombor topilmadi." });
    }

    const purchase = await this.prisma.$transaction(async (tx) => {
      if (items) {
        await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
      }

      return tx.purchase.update({
        where: { id, companyId: tenantId },
        data: {
          supplierId: body.supplierId,
          supplierName: body.supplierName,
          warehouseId: body.warehouseId,
          warehouseName: body.warehouseName,
          expectedDate: body.expectedDate === undefined ? undefined : parseOptionalDate(body.expectedDate),
          note: body.note,
          subtotal: total,
          total,
          debtAmount: total === undefined ? undefined : Math.max(total - toNumber(existing.paidAmount), 0),
          items: items ? { create: items } : undefined,
        },
        include: { items: true },
      });
    });

    return this.purchaseDto(purchase);
  }

  async receivePurchase(companyId: string, id: string, body: any, actorUserId?: string) {
    const tenantId = this.requireCompany(companyId);

    return this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findFirst({ where: { id, companyId: tenantId }, include: { items: true } });
      if (!purchase) throw new NotFoundException({ code: "PURCHASE_NOT_FOUND", message: "Xarid topilmadi." });
      if (purchase.status === "RECEIVED" || purchase.status === "CANCELLED") {
        throw new ConflictException({ code: "PURCHASE_RECEIVE_BLOCKED", message: "Bu xaridni qabul qilib bo'lmaydi." });
      }

      const receivedItems = Array.isArray(body.receivedItems) ? body.receivedItems : purchase.items.map((item) => ({ productId: item.productId, purchaseItemId: item.id, quantity: Math.max(toNumber(item.quantity) - toNumber(item.receivedQuantity), 0) }));
      const receiveKey = body.idempotencyKey || `purchase-receive:${purchase.id}:${receivedItems.map((item: any) => `${item.purchaseItemId || item.productId}:${item.quantity}`).join(",")}`;
      const previousReceive = await tx.stockMovement.findFirst({ where: { companyId: tenantId, sourceType: "PURCHASE", sourceId: purchase.id, idempotencyKey: { startsWith: receiveKey } } });
      if (previousReceive) {
        const fresh = await tx.purchase.findFirst({ where: { id: purchase.id, companyId: tenantId }, include: { items: true } });
        return this.purchaseDto(fresh);
      }
      const warehouseId = body.warehouseId || purchase.warehouseId || (await this.ensureDefaultWarehouse(tenantId)).id;
      await this.requireWarehouse(tx, tenantId, warehouseId);

      for (const received of receivedItems) {
        const item = purchase.items.find((entry) => entry.id === received.purchaseItemId || entry.productId === received.productId);
        if (!item) continue;
        const amount = parseQuantity(received.quantity ?? 0, "Qabul miqdori");
        const remaining = toNumber(item.quantity) - toNumber(item.receivedQuantity);
        if (amount <= 0) continue;
        if (amount > remaining) throw new ConflictException({ code: "DUPLICATE_RECEIVE", message: "Qabul miqdori qoldiqdan oshmasin." });

        await tx.purchaseItem.update({ where: { id: item.id }, data: { receivedQuantity: { increment: amount } } });
        if (item.productId) {
          await this.adjustStockDelta(tx, tenantId, warehouseId, item.productId, amount, {
            type: "IN",
            reason: "PURCHASE_RECEIVE",
            sourceType: "PURCHASE",
            sourceId: purchase.id,
            cost: toNumber(item.cost),
            batchNumber: received.batchNumber,
            expiryDate: received.expiryDate || body.expiryDate,
            receivedDate: body.receivedDate || new Date(),
            idempotencyKey: `${receiveKey}:${item.id}`,
          });
          await tx.supplierPriceHistory.create({
            data: {
              companyId: tenantId,
              supplierId: purchase.supplierId,
              productId: item.productId,
              unit: item.unit,
              price: item.cost,
              currency: body.currency || "UZS",
              sourceType: "PURCHASE_RECEIVE",
              sourceId: purchase.id,
            },
          });
        }
      }

      const freshItems = await tx.purchaseItem.findMany({ where: { purchaseId: purchase.id } });
      const allReceived = freshItems.every((item) => toNumber(item.receivedQuantity) >= toNumber(item.quantity));
      const anyReceived = freshItems.some((item) => toNumber(item.receivedQuantity) > 0);
      const receivedTotal = roundMoney(
        freshItems.reduce((sum, item) => sum + toNumber(item.receivedQuantity) * toNumber(item.cost), 0),
      );
      const nextDebt = roundMoney(Math.max(receivedTotal - toNumber(purchase.paidAmount), 0));
      const updated = await tx.purchase.update({
        where: { id: purchase.id },
        data: {
          status: allReceived ? "RECEIVED" : anyReceived ? "PARTIALLY_RECEIVED" : purchase.status,
          receivedAt: allReceived ? new Date() : purchase.receivedAt,
          debtAmount: nextDebt,
        },
        include: { items: true },
      });

      const debtDelta = roundMoney(nextDebt - toNumber(purchase.debtAmount));
      if (purchase.supplierId && debtDelta !== 0) {
        await tx.supplier.update({
          where: { id: purchase.supplierId, companyId: tenantId },
          data: { debtBalance: debtDelta > 0 ? { increment: debtDelta } : { decrement: Math.abs(debtDelta) } },
        });
      }

      await this.writeAudit(tx, tenantId, actorUserId, "purchase.receive", "purchase", purchase.id, { receivedItems, warehouseId });
      return this.purchaseDto(updated);
    });
  }

  async payPurchase(companyId: string, id: string, body: any, actorUserId?: string) {
    const tenantId = this.requireCompany(companyId);
    const amount = roundMoney(body.amount);
    const idempotencyKey = body.idempotencyKey || `purchase-payment:${id}:${amount}:${body.method || body.paymentMethod || "CASH"}`;
    if (amount <= 0) throw new BadRequestException({ code: "INVALID_AMOUNT", message: "To'lov 0 dan katta bo'lsin." });

    return this.prisma.$transaction(async (tx) => {
      const existingPayment = await tx.financeTransaction.findUnique({
        where: { companyId_idempotencyKey: { companyId: tenantId, idempotencyKey } },
      });
      if (existingPayment) {
        const existingPurchase = await tx.purchase.findFirst({ where: { id, companyId: tenantId }, include: { items: true } });
        if (!existingPurchase) throw new NotFoundException({ code: "PURCHASE_NOT_FOUND", message: "Xarid topilmadi." });
        return this.purchaseDto(existingPurchase);
      }

      const purchase = await tx.purchase.findFirst({ where: { id, companyId: tenantId } });
      if (!purchase) throw new NotFoundException({ code: "PURCHASE_NOT_FOUND", message: "Xarid topilmadi." });
      if (!["PARTIALLY_RECEIVED", "RECEIVED"].includes(purchase.status)) {
        throw new ConflictException({ code: "PURCHASE_NOT_RECEIVED", message: "Avval xaridni qabul qiling." });
      }
      if (amount > toNumber(purchase.debtAmount)) throw new BadRequestException({ code: "OVERPAYMENT", message: "To'lov qarz summasidan oshmasin." });
      const nextPaid = roundMoney(toNumber(purchase.paidAmount) + amount);
      const nextDebt = roundMoney(Math.max(toNumber(purchase.total) - nextPaid, 0));
      const updated = await tx.purchase.update({
        where: { id, companyId: tenantId },
        data: { paidAmount: nextPaid, debtAmount: nextDebt },
        include: { items: true },
      });

      if (purchase.supplierId) {
        await tx.supplier.update({ where: { id: purchase.supplierId, companyId: tenantId }, data: { debtBalance: { decrement: Math.min(amount, toNumber(purchase.debtAmount)) } } });
      }
      await this.createFinanceTx(tx, tenantId, {
        type: "OUT",
        amount,
        category: "SUPPLIER_PAYMENT",
        sourceType: "PURCHASE_PAYMENT",
        sourceId: id,
        idempotencyKey,
        purchaseId: id,
        supplierId: purchase.supplierId,
        method: body.method || body.paymentMethod || "CASH",
        description: body.note || `Purchase payment ${purchase.number}`,
      });
      await this.writeAudit(tx, tenantId, actorUserId, "supplier.payment", "purchase", id, { amount, beforeDebt: purchase.debtAmount, afterDebt: nextDebt });

      return this.purchaseDto(updated);
    });
  }

  async cancelPurchase(companyId: string, id: string) {
    const tenantId = this.requireCompany(companyId);
    const purchase = await this.getPurchase(tenantId, id);
    if (purchase.status === "RECEIVED") throw new ConflictException({ code: "PURCHASE_RECEIVED", message: "Qabul qilingan xarid bekor qilinmaydi." });
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.purchase.update({ where: { id, companyId: tenantId }, data: { status: "CANCELLED", cancelledAt: new Date() }, include: { items: true } });
      if (purchase.supplierId && toNumber(purchase.debtAmount) > 0) {
        await tx.supplier.update({ where: { id: purchase.supplierId, companyId: tenantId }, data: { debtBalance: { decrement: purchase.debtAmount } } });
      }
      return result;
    });

    return this.purchaseDto(updated);
  }

  async listSales(companyId: string, query: Record<string, string | undefined>) {
    const where: any = { companyId: this.requireCompany(companyId) };
    if (query.status) where.status = query.status;
    if (query.customerId) where.customerId = query.customerId;
    if (query.agentId) where.agentId = query.agentId;
    const sales = await this.prisma.sale.findMany({ where, include: { items: true, payments: true, returns: true }, orderBy: { createdAt: "desc" }, take: 300 });

    return { sales: sales.map(this.saleDto), data: sales.map(this.saleDto) };
  }

  async getSale(companyId: string, id: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { id, companyId: this.requireCompany(companyId) },
      include: { items: true, payments: true, returns: true },
    });

    if (!sale) throw new NotFoundException({ code: "SALE_NOT_FOUND", message: "Savdo topilmadi." });

    return this.saleDto(sale);
  }

  async holdSale(companyId: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const normalized: any = this.normalizeSalePayload(body);
    await this.validateProductIds(this.prisma, tenantId, normalized.items.map((item) => item.productId));
    await this.applyProductUnits(this.prisma, tenantId, normalized.items);
    if (normalized.id) {
      const existing = await this.prisma.sale.findFirst({ where: { id: normalized.id, companyId: tenantId } });
      if (!existing) throw new NotFoundException({ code: "SALE_NOT_FOUND", message: "Savdo topilmadi." });
    }
    const sale = await this.prisma.sale.upsert({
      where: normalized.id ? { id: normalized.id } : { companyId_number: { companyId: tenantId, number: normalized.number || (await this.generateNumber(this.prisma, tenantId, "sale")) } },
      create: {
        ...this.saleCreateData(tenantId, normalized, "DRAFT"),
        number: normalized.number || (await this.generateNumber(this.prisma, tenantId, "sale")),
        items: { create: normalized.items },
      },
      update: {
        ...this.saleUpdateData(normalized, "DRAFT"),
        items: { deleteMany: {}, create: normalized.items },
      },
      include: { items: true, payments: true, returns: true },
    });

    return this.saleDto(sale);
  }

  async completeSale(companyId: string, body: any, idempotencyKey?: string, actorUserId?: string) {
    const tenantId = this.requireCompany(companyId);
    const normalized: any = this.normalizeSalePayload(body);
    const key = idempotencyKey || body.idempotencyKey || normalized.id || `sale:${normalized.warehouseId}:${normalized.items.map((item: any) => `${item.productId}:${item.quantity}:${item.price}`).join(",")}:${normalized.total}`;

    if (key) {
      const existing = await this.prisma.sale.findFirst({
        where: { companyId: tenantId, idempotencyKey: key, status: "COMPLETED" },
        include: { items: true, payments: true, returns: true },
      });
      if (existing) return this.saleDto(existing);
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = normalized.id ? await tx.sale.findFirst({ where: { id: normalized.id, companyId: tenantId }, include: { items: true } }) : null;
      if (existing?.status === "COMPLETED") throw new ConflictException({ code: "SALE_ALREADY_COMPLETED", message: "Bu savdo allaqachon yakunlangan." });
      if (existing?.status === "CANCELLED") throw new ConflictException({ code: "SALE_CANCELLED", message: "Bekor qilingan savdo yakunlanmaydi." });
      if (!normalized.warehouseId) throw new BadRequestException({ code: "WAREHOUSE_REQUIRED", message: "Ombor tanlang." });
      if (!normalized.items.length) throw new BadRequestException({ code: "EMPTY_CART", message: "Savatcha bo'sh." });
      if (normalized.debtAmount > 0 && !normalized.customerId) throw new BadRequestException({ code: "CUSTOMER_REQUIRED_FOR_DEBT", message: "Qarz uchun mijoz tanlang." });
      if (normalized.paidAmount > normalized.total) throw new BadRequestException({ code: "OVERPAYMENT", message: "To'lov jami summadan oshmasin." });

      await this.requireWarehouse(tx, tenantId, normalized.warehouseId);
      await this.validateProductIds(tx, tenantId, normalized.items.map((item) => item.productId));
      await this.applyProductUnits(tx, tenantId, normalized.items);
      const customer = normalized.customerId
        ? await tx.customer.findFirst({ where: { id: normalized.customerId, companyId: tenantId, deletedAt: null } })
        : null;
      if (normalized.customerId && !customer) throw new NotFoundException({ code: "CUSTOMER_NOT_FOUND", message: "Mijoz topilmadi." });
      const agent = normalized.agentId
        ? await tx.agent.findFirst({ where: { id: normalized.agentId, companyId: tenantId, deletedAt: null } })
        : null;
      if (normalized.agentId && !agent) throw new NotFoundException({ code: "AGENT_NOT_FOUND", message: "Agent topilmadi." });
      if (customer && normalized.debtAmount > 0) {
        const creditLimit = toNumber(customer.creditLimit);
        const nextDebt = toNumber(customer.debtBalance) + normalized.debtAmount;
        if (creditLimit > 0 && nextDebt > creditLimit) {
          throw new ConflictException({ code: "CREDIT_LIMIT_EXCEEDED", message: "Mijoz kredit limiti oshib ketadi." });
        }
      }

      let saleCogs = 0;
      for (const item of normalized.items) {
        const allocations = await this.adjustStockDelta(tx, tenantId, normalized.warehouseId, item.productId, -item.quantity, {
          type: "OUT",
          reason: "SALE",
          sourceType: "SALE",
          sourceId: key || normalized.number || "sale",
          idempotencyKey: key ? `sale-stock:${key}:${item.productId}` : undefined,
        });
        item.cogs = roundMoney(allocations.reduce((sum: number, allocation: any) => sum + allocation.quantity * allocation.unitCost, 0), 6);
        saleCogs += item.cogs;
      }
      normalized.cogs = roundMoney(saleCogs, 6);
      normalized.profit = roundMoney(normalized.total - saleCogs, 6);

      const number = normalized.number || (await this.generateNumber(tx, tenantId, "sale"));
      const saleData = {
        ...this.saleCreateData(tenantId, normalized, "COMPLETED"),
        number,
        idempotencyKey: key,
        completedAt: new Date(),
        cogs: normalized.cogs,
        profit: normalized.profit,
        orderDate: normalized.orderDate || new Date(),
      };
      let sale;
      if (existing) {
        await tx.saleItem.deleteMany({ where: { saleId: existing.id } });
        await tx.salePayment.deleteMany({ where: { saleId: existing.id } });
        sale = await tx.sale.update({
          where: { id: existing.id },
          data: {
            ...this.saleUpdateData(normalized, "COMPLETED"),
            number,
            idempotencyKey: key,
            completedAt: new Date(),
            orderDate: normalized.orderDate || new Date(),
            cogs: normalized.cogs,
            profit: normalized.profit,
            items: { create: normalized.items },
            payments: { create: this.salePaymentCreateData(normalized.payments) },
          },
          include: { items: true, payments: true, returns: true },
        });
      } else {
        sale = await tx.sale.create({
          data: {
            ...saleData,
            items: { create: normalized.items },
            payments: { create: this.salePaymentCreateData(normalized.payments) },
          },
          include: { items: true, payments: true, returns: true },
        });
      }

      await tx.stockMovement.updateMany({
        where: { companyId: tenantId, sourceType: "SALE", sourceId: key || normalized.number || "sale" },
        data: { sourceId: sale.id },
      });

      for (const [index, payment] of normalized.payments.entries()) {
        await this.createFinanceTx(tx, tenantId, {
          type: "IN",
          amount: payment.amount,
          method: payment.method,
          category: "SALE_PAYMENT",
          sourceType: "SALE_PAYMENT",
          sourceId: sale.id,
          idempotencyKey: `sale-payment:${sale.id}:${payment.id || `${payment.method}:${index}`}`,
          saleId: sale.id,
          customerId: sale.customerId,
          agentId: sale.agentId,
          description: `Sale ${sale.number}`,
        });
      }
      if (sale.customerId && toNumber(sale.debtAmount) > 0) {
        await tx.customer.update({ where: { id: sale.customerId, companyId: tenantId }, data: { debtBalance: { increment: sale.debtAmount } } });
      }
      if (sale.agentId && toNumber(sale.total) > 0) {
        const agent = await tx.agent.findFirst({ where: { id: sale.agentId, companyId: tenantId } });
        const commission = roundMoney(toNumber(sale.total) * toNumber(agent?.commissionRate) / 100);
        if (commission > 0) await tx.agent.update({ where: { id: sale.agentId, companyId: tenantId }, data: { balance: { increment: commission } } });
      }

      await this.writeAudit(tx, tenantId, actorUserId, "sale.complete", "sale", sale.id, { cogs: normalized.cogs, total: normalized.total });

      return this.saleDto(sale);
    });
  }

  async cancelSale(companyId: string, id: string, body: any, actorUserId?: string) {
    const tenantId = this.requireCompany(companyId);

    return this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({ where: { id, companyId: tenantId }, include: { items: true, returns: true, payments: true } });
      if (!sale) throw new NotFoundException({ code: "SALE_NOT_FOUND", message: "Savdo topilmadi." });
      if (sale.status === "CANCELLED") throw new ConflictException({ code: "SALE_ALREADY_CANCELLED", message: "Savdo allaqachon bekor qilingan." });
      if (sale.status !== "COMPLETED") throw new ConflictException({ code: "SALE_NOT_COMPLETED", message: "Faqat yakunlangan savdo bekor qilinadi." });

      for (const item of sale.items) {
        const returned = sale.returns.filter((entry) => entry.productId === item.productId).reduce((sum, entry) => sum + toNumber(entry.quantity), 0);
        const restore = roundQuantity(toNumber(item.quantity) - returned);
        if (restore > 0 && item.productId && sale.warehouseId) {
          await this.adjustStockDelta(tx, tenantId, sale.warehouseId, item.productId, restore, {
            type: "IN",
            reason: "SALE_CANCEL",
            sourceType: "SALE_CANCEL",
            sourceId: sale.id,
            note: body.reason,
          });
        }
      }
      if (sale.customerId && toNumber(sale.debtAmount) > 0) {
        await tx.customer.update({ where: { id: sale.customerId, companyId: tenantId }, data: { debtBalance: { decrement: sale.debtAmount } } });
      }
      if (sale.agentId && toNumber(sale.total) > 0) {
        const agent = await tx.agent.findFirst({ where: { id: sale.agentId, companyId: tenantId } });
        const commission = roundMoney(toNumber(sale.total) * toNumber(agent?.commissionRate) / 100);
        if (commission > 0) {
          await tx.agent.update({ where: { id: sale.agentId, companyId: tenantId }, data: { balance: { decrement: commission } } });
        }
      }
      if (toNumber(sale.paidAmount) > 0) {
        await this.createFinanceTx(tx, tenantId, {
          type: "OUT",
          amount: toNumber(sale.paidAmount),
          category: "REFUND",
          sourceType: "SALE_CANCEL",
          sourceId: sale.id,
          idempotencyKey: `sale-cancel:${sale.id}`,
          saleId: sale.id,
          customerId: sale.customerId,
          description: body.reason || `Cancel ${sale.number}`,
        });
      }
      const updated = await tx.sale.update({
        where: { id, companyId: tenantId },
        data: { status: "CANCELLED", cancelledAt: new Date(), note: [sale.note, body.reason].filter(Boolean).join(" | ") },
        include: { items: true, payments: true, returns: true },
      });
      await this.writeAudit(tx, tenantId, actorUserId, "sale.cancel", "sale", id, { reason: body.reason || null });

      return this.saleDto(updated);
    });
  }

  async returnSale(companyId: string, id: string, body: any, actorUserId?: string) {
    const tenantId = this.requireCompany(companyId);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) throw new BadRequestException({ code: "RETURN_ITEMS_REQUIRED", message: "Qaytariladigan mahsulot tanlang." });
    const idempotencyKey = body.idempotencyKey || `sale-return:${id}:${items.map((item: any) => `${item.productId}:${item.quantity}`).join(",")}`;

    return this.prisma.$transaction(async (tx) => {
      const existingRefund = await tx.financeTransaction.findUnique({
        where: { companyId_idempotencyKey: { companyId: tenantId, idempotencyKey } },
      });
      if (existingRefund) {
        const existingSale = await tx.sale.findFirst({ where: { id, companyId: tenantId }, include: { items: true, payments: true, returns: true } });
        if (!existingSale) throw new NotFoundException({ code: "SALE_NOT_FOUND", message: "Savdo topilmadi." });
        return this.saleDto(existingSale);
      }
      const sale = await tx.sale.findFirst({ where: { id, companyId: tenantId }, include: { items: true, returns: true } });
      if (!sale) throw new NotFoundException({ code: "SALE_NOT_FOUND", message: "Savdo topilmadi." });
      if (sale.status !== "COMPLETED") throw new ConflictException({ code: "SALE_NOT_COMPLETED", message: "Faqat yakunlangan savdo qaytariladi." });
      const createdReturns: any[] = [];

      for (const item of items) {
        const sold = sale.items.find((entry) => entry.productId === item.productId);
        if (!sold || !sold.productId || !sale.warehouseId) throw new BadRequestException({ code: "RETURN_ITEM_NOT_FOUND", message: "Qaytarish mahsuloti savdoda yo'q." });
        const already = sale.returns.filter((entry) => entry.productId === sold.productId).reduce((sum, entry) => sum + toNumber(entry.quantity), 0);
        const qty = parseQuantity(item.quantity, "Qaytarish miqdori");
        if (qty <= 0 || qty > toNumber(sold.quantity) - already) throw new BadRequestException({ code: "RETURN_QUANTITY_INVALID", message: "Qaytarish miqdori noto'g'ri." });
        await this.adjustStockDelta(tx, tenantId, sale.warehouseId, sold.productId, qty, {
          type: "RETURN",
          reason: "SALE_RETURN",
          sourceType: "SALE_RETURN",
          sourceId: sale.id,
          note: item.reason || body.reason,
        });
        createdReturns.push({
          productId: sold.productId,
          productName: sold.productName,
          sku: sold.sku,
          unit: sold.unit,
          quantity: qty,
          refundAmount: roundMoney(item.refundAmount ?? toNumber(sold.price) * qty),
          reason: item.reason || body.reason,
        });
      }

      const refund = createdReturns.reduce((sum, item) => sum + item.refundAmount, 0);
      if (refund > 0) {
        await this.createFinanceTx(tx, tenantId, {
          type: "OUT",
          amount: refund,
          category: "REFUND",
          sourceType: "SALE_RETURN",
          sourceId: sale.id,
          idempotencyKey,
          saleId: sale.id,
          customerId: sale.customerId,
          description: body.reason || `Return ${sale.number}`,
        });
      }
      const updated = await tx.sale.update({
        where: { id, companyId: tenantId },
        data: {
          returnedAmount: { increment: refund },
          returnStatus: "PARTIALLY_RETURNED",
          returns: { create: createdReturns },
        },
        include: { items: true, payments: true, returns: true },
      });
      await this.writeAudit(tx, tenantId, actorUserId, "sale.return", "sale", id, { items: createdReturns, refund });

      return this.saleDto(updated);
    });
  }

  async listCustomers(companyId: string) {
    const customers = await this.prisma.customer.findMany({
      where: { companyId: this.requireCompany(companyId), deletedAt: null },
      include: { agent: true, sales: { where: { status: "COMPLETED" }, orderBy: { createdAt: "desc" }, take: 5 } },
      orderBy: { createdAt: "desc" },
    });

    return { customers: customers.map(this.customerDto), data: customers.map(this.customerDto) };
  }

  async getCustomer(companyId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, companyId: this.requireCompany(companyId), deletedAt: null },
      include: { agent: true, sales: { include: { items: true, payments: true, returns: true }, orderBy: { createdAt: "desc" } } },
    });
    if (!customer) throw new NotFoundException({ code: "CUSTOMER_NOT_FOUND", message: "Mijoz topilmadi." });

    return this.customerDto(customer);
  }

  async createCustomer(companyId: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const name = String(body.name || body.fullName || body.companyName || "").trim();
    if (!name) throw new BadRequestException({ code: "CUSTOMER_NAME_REQUIRED", message: "Mijoz nomini kiriting.", field: "name" });
    if (body.agentId) {
      const agent = await this.prisma.agent.findFirst({ where: { id: body.agentId, companyId: tenantId, deletedAt: null } });
      if (!agent) throw new NotFoundException({ code: "AGENT_NOT_FOUND", message: "Agent topilmadi." });
    }
    const customer = await this.prisma.customer.create({
      data: {
        companyId: tenantId,
        name,
        fullName: body.fullName,
        companyName: body.companyName,
        contactPerson: body.contactPerson,
        phone: body.phone,
        email: body.email,
        type: body.type || "INDIVIDUAL",
        region: body.region,
        agentId: body.agentId || null,
        creditLimit: toNumber(body.creditLimit),
        segment: body.segment || "NEW",
        tags: body.tags || [],
        notes: body.notes || [],
        followUps: body.followUps || [],
        status: body.status || "ACTIVE",
      },
    });

    return this.customerDto(customer);
  }

  async updateCustomer(companyId: string, id: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    await this.getCustomer(companyId, id);
    if (body.agentId) {
      const agent = await this.prisma.agent.findFirst({ where: { id: body.agentId, companyId: tenantId, deletedAt: null } });
      if (!agent) throw new NotFoundException({ code: "AGENT_NOT_FOUND", message: "Agent topilmadi." });
    }
    const customer = await this.prisma.customer.update({
      where: { id, companyId: tenantId },
      data: {
        name: body.name,
        fullName: body.fullName,
        companyName: body.companyName,
        contactPerson: body.contactPerson,
        phone: body.phone,
        email: body.email,
        type: body.type,
        region: body.region,
        agentId: body.agentId,
        creditLimit: body.creditLimit === undefined ? undefined : toNumber(body.creditLimit),
        segment: body.segment,
        tags: body.tags,
        notes: body.notes,
        followUps: body.followUps,
        status: body.status,
      },
    });

    return this.customerDto(customer);
  }

  async deleteCustomer(companyId: string, id: string) {
    const tenantId = this.requireCompany(companyId);
    await this.getCustomer(companyId, id);
    const [sales, payments] = await Promise.all([
      this.prisma.sale.count({ where: { customerId: id, companyId: tenantId } }),
      this.prisma.financeTransaction.count({ where: { customerId: id, companyId: tenantId } }),
    ]);
    if (sales > 0 || payments > 0) {
      await this.prisma.customer.update({ where: { id, companyId: tenantId }, data: { status: "INACTIVE", deletedAt: new Date() } });
      return { deleted: true, softDelete: true };
    }
    await this.prisma.customer.delete({ where: { id, companyId: tenantId } });
    return { deleted: true, softDelete: false };
  }

  async receiveCustomerPayment(companyId: string, id: string, body: any, actorUserId?: string) {
    const tenantId = this.requireCompany(companyId);
    const amount = roundMoney(body.amount);
    const idempotencyKey = body.idempotencyKey || `customer-payment:${id}:${amount}:${body.method || body.paymentMethod || "CASH"}`;
    if (amount <= 0) throw new BadRequestException({ code: "INVALID_AMOUNT", message: "To'lov 0 dan katta bo'lsin." });

    return this.prisma.$transaction(async (tx) => {
      const existingPayment = await tx.financeTransaction.findUnique({
        where: { companyId_idempotencyKey: { companyId: tenantId, idempotencyKey } },
      });
      if (existingPayment) {
        const existingCustomer = await tx.customer.findFirst({ where: { id, companyId: tenantId } });
        if (!existingCustomer) throw new NotFoundException({ code: "CUSTOMER_NOT_FOUND", message: "Mijoz topilmadi." });
        return this.customerDto(existingCustomer);
      }

      const customer = await tx.customer.findFirst({ where: { id, companyId: tenantId } });
      if (!customer) throw new NotFoundException({ code: "CUSTOMER_NOT_FOUND", message: "Mijoz topilmadi." });
      if (amount > toNumber(customer.debtBalance)) {
        throw new BadRequestException({ code: "OVERPAYMENT", message: "To'lov mijoz qarzidan oshmasin." });
      }
      const decrement = Math.min(amount, toNumber(customer.debtBalance));
      const updated = await tx.customer.update({ where: { id, companyId: tenantId }, data: { debtBalance: { decrement } } });
      await this.createFinanceTx(tx, tenantId, {
        type: "IN",
        amount,
        category: "CUSTOMER_PAYMENT",
        sourceType: "CUSTOMER_PAYMENT",
        sourceId: id,
        idempotencyKey,
        customerId: id,
        method: body.method || body.paymentMethod || "CASH",
        description: body.note || `Customer payment ${customer.name}`,
      });
      await this.writeAudit(tx, tenantId, actorUserId, "customer.debt_payment", "customer", id, { amount, beforeDebt: customer.debtBalance, afterDebt: toNumber(customer.debtBalance) - decrement });

      return this.customerDto(updated);
    });
  }

  async listAgents(companyId: string) {
    const agents = await this.prisma.agent.findMany({
      where: { companyId: this.requireCompany(companyId), deletedAt: null },
      include: { customers: true, sales: { where: { status: "COMPLETED" } } },
      orderBy: { createdAt: "desc" },
    });

    return { agents: agents.map(this.agentDto), data: agents.map(this.agentDto) };
  }

  async getAgent(companyId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id, companyId: this.requireCompany(companyId), deletedAt: null },
      include: { customers: true, sales: { include: { items: true, payments: true, returns: true }, orderBy: { createdAt: "desc" } } },
    });
    if (!agent) throw new NotFoundException({ code: "AGENT_NOT_FOUND", message: "Agent topilmadi." });

    return this.agentDto(agent);
  }

  async createAgent(companyId: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const name = String(body.name || body.fullName || "").trim();
    if (!name) throw new BadRequestException({ code: "AGENT_NAME_REQUIRED", message: "Agent nomini kiriting.", field: "name" });
    const agent = await this.prisma.agent.create({
      data: {
        companyId: tenantId,
        name,
        phone: body.phone,
        email: body.email,
        targetAmount: toNumber(body.targetAmount || body.target),
        commissionRate: toNumber(body.commissionRate || body.commission),
        status: body.status || "ACTIVE",
      },
    });

    return this.agentDto(agent);
  }

  async updateAgent(companyId: string, id: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    await this.getAgent(companyId, id);
    const agent = await this.prisma.agent.update({
      where: { id, companyId: tenantId },
      data: {
        name: body.name || body.fullName,
        phone: body.phone,
        email: body.email,
        targetAmount: body.targetAmount === undefined && body.target === undefined ? undefined : toNumber(body.targetAmount || body.target),
        commissionRate: body.commissionRate === undefined && body.commission === undefined ? undefined : toNumber(body.commissionRate || body.commission),
        status: body.status,
      },
    });

    return this.agentDto(agent);
  }

  async deleteAgent(companyId: string, id: string) {
    const tenantId = this.requireCompany(companyId);
    await this.getAgent(companyId, id);
    await this.prisma.agent.update({ where: { id, companyId: tenantId }, data: { status: "INACTIVE", deletedAt: new Date() } });

    return { deleted: true, softDelete: true };
  }

  async listBoms(companyId: string) {
    const boms = await this.prisma.bom.findMany({ where: { companyId: this.requireCompany(companyId) }, include: { materials: true, outputProduct: true }, orderBy: [{ versionGroupId: "asc" }, { version: "desc" }] });

    return { boms: boms.map(this.bomDto), data: boms.map(this.bomDto) };
  }

  async createBom(companyId: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const materials = Array.isArray(body.materials) ? body.materials : Array.isArray(body.items) ? body.items : [];
    const bom = await this.prisma.$transaction(async (tx) => {
      const output = await this.ensureProduct(tx, tenantId, body.outputProductId || body.productId, body.outputProductName || body.productName, "FINISHED_GOOD", body.unit);
      const materialData: any[] = [];
      for (const item of materials) {
        const material = await this.ensureProduct(tx, tenantId, item.productId, item.productName || item.name, "RAW_MATERIAL", item.unit);
        materialData.push({
          productId: material.id,
          productName: material.name,
          quantity: parseQuantity(item.quantity, "Xomashyo miqdori"),
          unit: material.unit,
          cost: roundMoney(item.cost ?? material.cost),
        });
      }
      const created = await tx.bom.create({
        data: {
          companyId: tenantId,
          name: String(body.name || "Retsept").trim(),
          outputProductId: output.id,
          outputProductName: output.name,
          outputQuantity: parseQuantity(body.outputQuantity ?? body.quantity ?? 1, "Chiqish miqdori"),
          unit: output.unit,
          overheadCost: roundMoney(body.overheadCost),
          status: body.status || "ACTIVE",
          version: 1,
          normalWastePercent: body.normalWastePercent === undefined || body.normalWastePercent === "" ? null : toNumber(body.normalWastePercent),
          materials: { create: materialData },
        },
        include: { materials: true, outputProduct: true },
      });
      return tx.bom.update({ where: { id: created.id }, data: { versionGroupId: created.id }, include: { materials: true, outputProduct: true } });
    });

    return this.bomDto(bom);
  }

  async getBom(companyId: string, id: string) {
    const bom = await this.prisma.bom.findFirst({ where: { id, companyId: this.requireCompany(companyId) }, include: { materials: true, outputProduct: true } });
    if (!bom) throw new NotFoundException({ code: "BOM_NOT_FOUND", message: "BOM topilmadi." });
    return this.bomDto(bom);
  }

  async updateBom(companyId: string, id: string, body: any, actorUserId?: string) {
    const tenantId = this.requireCompany(companyId);
    const current = await this.prisma.bom.findFirst({ where: { id, companyId: tenantId }, include: { materials: true } });
    if (!current) throw new NotFoundException({ code: "RECIPE_NOT_FOUND", message: "Retsept topilmadi." });
    const materials = Array.isArray(body.materials || body.items) ? (body.materials || body.items) : current.materials;
    if (Array.isArray(materials)) {
      await this.validateProductIds(this.prisma, tenantId, [body.outputProductId || body.productId, ...materials.map((item: any) => item.productId)]);
    }
    const outputProduct = body.outputProductId || body.productId
      ? await this.prisma.product.findFirst({ where: { id: body.outputProductId || body.productId, companyId: tenantId, deletedAt: null } })
      : await this.prisma.product.findFirst({ where: { id: current.outputProductId || "", companyId: tenantId, deletedAt: null } });
    if ((body.outputProductId || body.productId) && !outputProduct) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: "Mahsulot topilmadi." });
    const materialProducts = materials.length
      ? await this.prisma.product.findMany({ where: { companyId: tenantId, id: { in: materials.map((item: any) => item.productId).filter(Boolean) }, deletedAt: null } })
      : [];
    const materialMap = new Map(materialProducts.map((product) => [product.id, product]));
    const bom = await this.prisma.$transaction(async (tx) => {
      await tx.bom.update({ where: { id, companyId: tenantId }, data: { status: "INACTIVE" } });
      return tx.bom.create({
        data: {
          name: body.name || current.name,
          companyId: tenantId,
          outputProductId: outputProduct?.id || current.outputProductId,
          outputProductName: outputProduct?.name || body.outputProductName || body.productName || current.outputProductName,
          outputQuantity: body.outputQuantity === undefined && body.quantity === undefined ? current.outputQuantity : parseQuantity(body.outputQuantity ?? body.quantity, "Chiqish miqdori"),
          unit: outputProduct?.unit || (body.unit === undefined ? current.unit : normalizeUnit(body.unit)),
          overheadCost: body.overheadCost === undefined ? current.overheadCost : roundMoney(body.overheadCost),
          status: body.status || "ACTIVE",
          version: current.version + 1,
          versionGroupId: current.versionGroupId || current.id,
          normalWastePercent: body.normalWastePercent === undefined ? current.normalWastePercent : body.normalWastePercent === null || body.normalWastePercent === "" ? null : toNumber(body.normalWastePercent),
          materials: { create: materials.map((item: any) => ({ productId: item.productId || null, productName: materialMap.get(item.productId)?.name || item.productName || item.name || "Material", quantity: parseQuantity(item.quantity, "Xomashyo miqdori"), unit: materialMap.get(item.productId)?.unit || normalizeUnit(item.unit || "dona"), cost: roundMoney(item.cost ?? materialMap.get(item.productId)?.cost) })) },
        },
        include: { materials: true, outputProduct: true },
      });
    });
    await this.writeAudit(this.prisma, tenantId, actorUserId, "recipe.change", "recipe", bom.id, { previousVersion: current.version, newVersion: bom.version });
    return this.bomDto(bom);
  }

  async deleteBom(companyId: string, id: string) {
    const tenantId = this.requireCompany(companyId);
    await this.getBom(companyId, id);
    await this.prisma.bom.update({ where: { id, companyId: tenantId }, data: { status: "ARCHIVED" } });
    return { deleted: true, softDelete: true };
  }

  async listProductionOrders(companyId: string) {
    const orders = await this.prisma.productionOrder.findMany({ where: { companyId: this.requireCompany(companyId) }, include: { bom: { include: { materials: true } }, stages: true }, orderBy: { createdAt: "desc" } });
    return { orders: orders.map(this.productionOrderDto), productionOrders: orders.map(this.productionOrderDto), data: orders.map(this.productionOrderDto) };
  }

  async createProductionOrder(companyId: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const bom = body.bomId ? await this.prisma.bom.findFirst({ where: { id: body.bomId, companyId: tenantId }, include: { materials: true } }) : null;
    if (body.bomId && !bom) throw new NotFoundException({ code: "BOM_NOT_FOUND", message: "BOM topilmadi." });
    const outputProductId = body.outputProductId || bom?.outputProductId;
    const output = outputProductId
      ? await this.prisma.product.findFirst({ where: { id: outputProductId, companyId: tenantId, deletedAt: null } })
      : null;
    if (outputProductId && !output) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: "Mahsulot topilmadi." });
    if (body.warehouseId) await this.requireWarehouse(this.prisma, tenantId, body.warehouseId);
    const company = await this.prisma.company.findFirst({ where: { id: tenantId }, select: { currency: true } });
    const overhead = this.normalizeOverheadItems(body.overheadItems);
    const recipeSnapshot = bom ? {
      id: bom.id,
      version: bom.version,
      name: bom.name,
      outputQuantity: toNumber(bom.outputQuantity),
      unit: bom.unit,
      normalWastePercent: bom.normalWastePercent === null || bom.normalWastePercent === undefined ? (output?.normalWastePercent === null || output?.normalWastePercent === undefined ? null : toNumber(output.normalWastePercent)) : toNumber(bom.normalWastePercent),
      materials: bom.materials.map((material: any) => ({ productId: material.productId, productName: material.productName, quantity: toNumber(material.quantity), unit: material.unit, cost: toNumber(material.cost) })),
    } : null;
    const requestedStages = Array.isArray(body.stages) ? body.stages : [];
    const stages = requestedStages.length ? requestedStages : ["Tayyorlash", "Ishlab chiqarish", "Sifat nazorati"];
    const order = await this.prisma.productionOrder.create({
      data: {
        companyId: tenantId,
        number: body.number || (await this.generateNumber(this.prisma, tenantId, "production")),
        bomId: bom?.id || null,
        outputProductId: output?.id || null,
        outputProductName: output?.name || body.outputProductName || bom?.outputProductName,
        unit: output?.unit || bom?.unit || normalizeUnit(body.unit),
        plannedQuantity: parseQuantity(body.plannedQuantity ?? body.quantity ?? 1, "Rejalashtirilgan miqdor"),
        warehouseId: body.warehouseId || null,
        overheadCost: overhead.total || roundMoney(body.overheadCost ?? bom?.overheadCost),
        overheadItems: overhead.items,
        recipeVersion: bom?.version || null,
        recipeSnapshot: recipeSnapshot || undefined,
        packaging: Array.isArray(body.packaging) ? body.packaging : [],
        currency: normalizeCurrency(body.currency ?? company?.currency ?? "UZS"),
        status: body.status || "PLANNED",
        note: body.note,
        stages: {
          create: stages.map((stage: any) => ({
            name: stage.name || String(stage),
            status: stage.status === "PENDING" ? "PLANNED" : stage.status || "PLANNED",
          })),
        },
      },
      include: { bom: { include: { materials: true } }, stages: true },
    });
    return this.productionOrderDto(order);
  }

  async startProduction(companyId: string, id: string, body: any, actorUserId?: string) {
    const tenantId = this.requireCompany(companyId);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findFirst({ where: { id, companyId: tenantId }, include: { bom: { include: { materials: true } } } });
      if (!order) throw new NotFoundException({ code: "PRODUCTION_NOT_FOUND", message: "Ishlab chiqarish topilmadi." });
      if (order.status === "IN_PROGRESS") return this.productionOrderDto(order);
      if (order.status === "COMPLETED" || order.status === "CANCELLED") throw new ConflictException({ code: "PRODUCTION_LOCKED", message: "Bu buyurtmani start qilib bo'lmaydi." });
      if (!order.bom) throw new BadRequestException({ code: "BOM_REQUIRED", message: "BOM topilmadi." });
      const warehouseId = body.warehouseId || order.warehouseId || (await this.ensureDefaultWarehouse(tenantId)).id;
      const materialProducts = await tx.product.findMany({
        where: { companyId: tenantId, id: { in: order.bom.materials.map((material) => material.productId).filter(Boolean) as string[] }, deletedAt: null },
        select: { id: true, name: true, unit: true, cost: true },
      });
      const productMap = new Map(materialProducts.map((product) => [product.id, product]));
      const materialSnapshot: any[] = [];
      let materialCost = 0;
      for (const material of order.bom.materials) {
        const product = material.productId ? productMap.get(material.productId) : null;
        const baseUnit = product?.unit || normalizeUnit(material.unit);
        const recipeQuantity = convertQuantity(toNumber(material.quantity), material.unit, baseUnit);
        const qty = roundQuantity(recipeQuantity * toNumber(order.plannedQuantity) / Math.max(toNumber(order.bom.outputQuantity), 1));
        const cost = toNumber(product?.cost ?? material.cost);
        materialSnapshot.push({
          productId: material.productId,
          productName: product?.name || material.productName,
          plannedQuantity: qty,
          actualQuantity: qty,
          unit: baseUnit,
          cost,
          recipeMaterialId: material.id,
        });
        if (material.productId) {
          await this.adjustStockDelta(tx, tenantId, warehouseId, material.productId, -qty, {
            type: "CONSUME",
            reason: "PRODUCTION_START",
            sourceType: "PRODUCTION",
            sourceId: order.id,
            idempotencyKey: `production-start:${order.id}:${material.productId}`,
          });
        }
        materialCost += qty * cost;
      }
      const updated = await tx.productionOrder.update({
        where: { id, companyId: tenantId },
        data: {
          status: "IN_PROGRESS",
          startedAt: new Date(),
          warehouseId,
          materialCost: roundMoney(materialCost),
          productionCost: roundMoney(materialCost + toNumber(order.overheadCost)),
          materialSnapshot,
          costingPolicy: "CURRENT_AT_START",
        },
        include: { bom: { include: { materials: true } }, stages: true },
      });
      await this.writeAudit(tx, tenantId, actorUserId, "production.start", "production_order", order.id, { status: order.status, materialSnapshot });
      return this.productionOrderDto(updated);
    });
  }

  async completeProduction(companyId: string, id: string, body: any, actorUserId?: string) {
    const tenantId = this.requireCompany(companyId);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findFirst({ where: { id, companyId: tenantId }, include: { bom: { include: { materials: true } } } });
      if (!order) throw new NotFoundException({ code: "PRODUCTION_NOT_FOUND", message: "Ishlab chiqarish topilmadi." });
      if (order.status === "COMPLETED") return this.productionOrderDto(order);
      if (order.status === "CANCELLED") throw new ConflictException({ code: "PRODUCTION_CANCELLED", message: "Bekor qilingan buyurtma yakunlanmaydi." });
      if (order.status !== "IN_PROGRESS") throw new ConflictException({ code: "PRODUCTION_NOT_STARTED", message: "Avval ishlab chiqarishni boshlang." });
      const warehouseId = body.warehouseId || order.warehouseId || (await this.ensureDefaultWarehouse(tenantId)).id;
      const actualQuantity = parseQuantity(body.producedQuantity ?? body.actualQuantity ?? body.quantity ?? order.plannedQuantity, "Ishlab chiqarilgan miqdor");
      if (!order.outputProductId) throw new BadRequestException({ code: "OUTPUT_PRODUCT_REQUIRED", message: "Output product kerak." });
      const packaging = this.normalizePackagingRows(body.packaging ?? order.packaging, order.unit);
      const packagedTotal = roundQuantity(packaging.reduce((sum, row) => sum + row.quantity * row.packSize, 0));
      if (packagedTotal > actualQuantity) throw new BadRequestException({ code: "PACKAGING_EXCEEDS_OUTPUT", message: "Qadoqlangan jami mahsulot ishlab chiqarilgan miqdordan oshmasin." });

      const snapshot = Array.isArray(order.materialSnapshot)
        ? order.materialSnapshot as any[]
        : (order.bom?.materials || []).map((material: any) => ({
          productId: material.productId,
          productName: material.productName,
          plannedQuantity: roundQuantity(toNumber(material.quantity) * toNumber(order.plannedQuantity) / Math.max(toNumber(order.bom?.outputQuantity), 1)),
          unit: normalizeUnit(material.unit),
          cost: toNumber(material.cost),
        }));
      const actualInput = Array.isArray(body.actualMaterials) ? body.actualMaterials : [];
      const actualByProduct = new Map<string, any>(actualInput.filter((item: any) => item.productId).map((item: any) => [item.productId, item] as [string, any]));
      const productIds = [...new Set([...snapshot.map((item) => item.productId), ...actualInput.map((item: any) => item.productId)].filter(Boolean))] as string[];
      const products = await tx.product.findMany({ where: { companyId: tenantId, id: { in: productIds }, deletedAt: null }, select: { id: true, name: true, unit: true, cost: true } });
      const productsById = new Map(products.map((product) => [product.id, product]));
      const materialEntries: any[] = [];
      let actualMaterialCost = 0;
      for (const planned of snapshot) {
        if (!planned.productId) continue;
        const product = productsById.get(planned.productId);
        const plannedQuantity = parseQuantity(planned.plannedQuantity ?? 0, "Reja xomashyo miqdori");
        const entered = actualByProduct.get(planned.productId);
        const actualMaterialQuantity = parseQuantity(entered?.actualQuantity ?? entered?.quantity ?? plannedQuantity, "Haqiqiy xomashyo miqdori");
        const delta = roundQuantity(actualMaterialQuantity - plannedQuantity);
        if (delta !== 0) {
          await this.adjustStockDelta(tx, tenantId, warehouseId, planned.productId, -delta, {
            type: delta > 0 ? "CONSUME" : "IN",
            reason: delta > 0 ? "PRODUCTION_ADJUSTMENT" : "PRODUCTION_UNUSED_RETURN",
            sourceType: "PRODUCTION",
            sourceId: order.id,
            idempotencyKey: `production-material:${order.id}:${planned.productId}`,
          });
        }
        const cost = toNumber(planned.cost ?? product?.cost);
        actualMaterialCost += actualMaterialQuantity * cost;
        materialEntries.push({
          productId: planned.productId,
          productName: planned.productName || product?.name,
          actualQuantity: actualMaterialQuantity,
          plannedQuantity,
          difference: roundQuantity(actualMaterialQuantity - plannedQuantity),
          differencePercent: plannedQuantity > 0 ? roundMoney(((actualMaterialQuantity - plannedQuantity) / plannedQuantity) * 100, 4) : 0,
          unit: planned.unit || product?.unit || "dona",
          cost,
        });
      }
      for (const entered of actualInput) {
        if (!entered.productId || snapshot.some((item) => item.productId === entered.productId)) continue;
        const product = productsById.get(entered.productId);
        const actualMaterialQuantity = parseQuantity(entered.actualQuantity ?? entered.quantity, "Haqiqiy xomashyo miqdori");
        if (actualMaterialQuantity > 0) {
          await this.adjustStockDelta(tx, tenantId, warehouseId, entered.productId, -actualMaterialQuantity, {
            type: "CONSUME", reason: "PRODUCTION_ADDITIONAL_CONSUMPTION", sourceType: "PRODUCTION", sourceId: order.id,
            idempotencyKey: `production-additional-material:${order.id}:${entered.productId}`,
          });
        }
        const cost = toNumber(product?.cost);
        actualMaterialCost += actualMaterialQuantity * cost;
        materialEntries.push({ productId: entered.productId, productName: product?.name, actualQuantity: actualMaterialQuantity, plannedQuantity: 0, unit: product?.unit || entered.unit || "dona", cost });
      }
      const quality = body.qualityControl || order.qualityControl || {};
      const acceptedQuantity = parseQuantity(body.acceptedQuantity ?? quality.acceptedQuantity ?? actualQuantity, "Qabul qilingan miqdor");
      const defectQuantity = parseQuantity(body.defectQuantity ?? quality.defectQuantity ?? 0, "Brak miqdori");
      const wasteQuantity = parseQuantity(body.wasteQuantity ?? quality.wasteQuantity ?? 0, "Chiqindi miqdori");
      const overhead = this.normalizeOverheadItems(Array.isArray(body.overheadItems) ? body.overheadItems : order.overheadItems);
      const overheadCost = overhead.items.length ? overhead.total : roundMoney(body.overheadCost ?? order.overheadCost);
      const actualProductionCost = roundMoney(actualMaterialCost + overheadCost, 6);
      const bulkQuantity = roundQuantity(actualQuantity - packagedTotal);
      if (bulkQuantity > 0) {
        await this.adjustStockDelta(tx, tenantId, warehouseId, order.outputProductId, bulkQuantity, {
          type: "PRODUCE", reason: packagedTotal > 0 ? "PRODUCTION_BULK_REMAINING" : "PRODUCTION_COMPLETE", sourceType: "PRODUCTION", sourceId: order.id,
          idempotencyKey: `production-output:${order.id}`,
          cost: actualQuantity > 0 ? actualProductionCost / actualQuantity : 0,
          expiryDate: body.expiryDate,
        });
      }
      const bulkUnitCost = actualQuantity > 0 ? actualProductionCost / actualQuantity : 0;
      for (const [index, row] of packaging.entries()) {
        const variant = await this.ensurePackagedVariant(tx, tenantId, order.outputProductId, order.outputProductName || "Tayyor mahsulot", "dona", row);
        await this.adjustStockDelta(tx, tenantId, warehouseId, variant.id, row.quantity, {
          type: "PRODUCE", reason: "PRODUCTION_PACKAGING", sourceType: "PRODUCTION_PACKAGING", sourceId: order.id,
          idempotencyKey: `production-package:${order.id}:${index}`, cost: bulkUnitCost * row.packSize,
          expiryDate: body.expiryDate,
        });
        for (const material of row.materials) {
          const totalMaterialQuantity = roundQuantity(material.quantity * row.quantity);
          if (totalMaterialQuantity > 0) await this.adjustStockDelta(tx, tenantId, warehouseId, material.productId, -totalMaterialQuantity, {
            type: "CONSUME", reason: "PACKAGING_MATERIAL", sourceType: "PRODUCTION_PACKAGING", sourceId: order.id,
            idempotencyKey: `production-packaging-material:${order.id}:${index}:${material.productId}`,
          });
        }
      }
      const yieldPercent = toNumber(order.plannedQuantity) > 0 ? roundMoney((acceptedQuantity / toNumber(order.plannedQuantity)) * 100, 4) : 0;
      const wastePercent = actualQuantity + wasteQuantity > 0 ? roundMoney((wasteQuantity / (actualQuantity + wasteQuantity)) * 100, 4) : 0;
      const updated = await tx.productionOrder.update({
        where: { id, companyId: tenantId },
        data: {
          status: "COMPLETED",
          actualQuantity,
          acceptedQuantity,
          defectQuantity,
          wasteQuantity,
          yieldPercent,
          wastePercent,
          packaging,
          remainingBulkQuantity: bulkQuantity,
          actualMaterials: materialEntries,
          actualMaterialCost: roundMoney(actualMaterialCost, 6),
          actualProductionCost,
          actualUnitCost: actualQuantity > 0 ? roundMoney(actualProductionCost / actualQuantity, 6) : 0,
          overheadItems: overhead.items,
          overheadCost,
          productionCost: roundMoney(actualProductionCost),
          unitCost: actualQuantity > 0 ? roundMoney(actualProductionCost / actualQuantity) : 0,
          qualityControl: body.qualityControl || undefined,
          qualityStatus: body.qualityStatus || quality.status || quality.result || undefined,
          qualityNote: body.qualityNote || quality.note || undefined,
          completionNote: body.completionNote || body.note || undefined,
          warehouseId,
          completedAt: new Date(),
        },
        include: { bom: { include: { materials: true } }, stages: true },
      });
      await this.writeAudit(tx, tenantId, actorUserId, "production.complete", "production_order", order.id, { producedQuantity: actualQuantity, packaging, yieldPercent, wastePercent, actualMaterialCost, actualProductionCost });
      return this.productionOrderDto(updated);
    });
  }

  async cancelProduction(companyId: string, id: string, body: any = {}, actorUserId?: string) {
    const tenantId = this.requireCompany(companyId);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findFirst({ where: { id, companyId: tenantId }, include: { bom: { include: { materials: true } }, stages: true } });
      if (!order) throw new NotFoundException({ code: "PRODUCTION_NOT_FOUND", message: "Ishlab chiqarish topilmadi." });
      if (order.status === "COMPLETED") throw new ConflictException({ code: "PRODUCTION_COMPLETED", message: "Yakunlangan ishlab chiqarish bekor qilinmaydi." });
      if (order.status === "CANCELLED") return this.productionOrderDto(order);
      if (order.status === "IN_PROGRESS" && order.warehouseId && Array.isArray(order.materialSnapshot)) {
        for (const material of order.materialSnapshot as any[]) {
          if (!material.productId || toNumber(material.plannedQuantity) <= 0) continue;
          await this.adjustStockDelta(tx, tenantId, order.warehouseId, material.productId, toNumber(material.plannedQuantity), {
            type: "IN", reason: "PRODUCTION_CANCEL_ROLLBACK", sourceType: "PRODUCTION_CANCEL", sourceId: order.id, note: body.reason,
            idempotencyKey: `production-cancel:${order.id}:${material.productId}`,
          });
        }
      }
      const updated = await tx.productionOrder.update({
        where: { id, companyId: tenantId },
        data: { status: "CANCELLED", cancelledAt: new Date(), note: [order.note, body.reason].filter(Boolean).join(" | ") || undefined },
        include: { bom: { include: { materials: true } }, stages: true },
      });
      await this.writeAudit(tx, tenantId, actorUserId, "production.cancel", "production_order", order.id, { reason: body.reason || null });
      return this.productionOrderDto(updated);
    });
  }

  async updateProductionStage(companyId: string, orderId: string, stageId: string, action: "start" | "complete", body: any = {}) {
    const tenantId = this.requireCompany(companyId);
    const stage = await this.prisma.productionStage.findFirst({ where: { id: stageId, orderId, order: { companyId: tenantId } }, include: { order: true } });
    if (!stage) throw new NotFoundException({ code: "PRODUCTION_STAGE_NOT_FOUND", message: "Bosqich topilmadi." });
    if (stage.order.status === "COMPLETED" || stage.order.status === "CANCELLED") throw new ConflictException({ code: "PRODUCTION_LOCKED", message: "Yakunlangan ishlab chiqarish bosqichi o'zgartirilmaydi." });
    if (action === "start" && !["PLANNED"].includes(stage.status)) throw new ConflictException({ code: "STAGE_TRANSITION_INVALID", message: "Bosqichni boshlash mumkin emas." });
    if (action === "complete" && stage.status !== "IN_PROGRESS") throw new ConflictException({ code: "STAGE_TRANSITION_INVALID", message: "Avval bosqichni boshlang." });
    const updated = await this.prisma.productionStage.update({ where: { id: stageId }, data: action === "start" ? { status: "IN_PROGRESS", startedAt: new Date() } : { status: "COMPLETED", endedAt: new Date(), notes: body.notes || body.note }, include: { order: true } });
    return { ...updated, status: updated.status === "PLANNED" ? "PENDING" : updated.status };
  }

  async updateProductionQuality(companyId: string, id: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const order = await this.prisma.productionOrder.findFirst({ where: { id, companyId: tenantId } });
    if (!order) throw new NotFoundException({ code: "PRODUCTION_NOT_FOUND", message: "Ishlab chiqarish topilmadi." });
    if (order.status === "COMPLETED" || order.status === "CANCELLED") throw new ConflictException({ code: "PRODUCTION_LOCKED", message: "Yakunlangan ishlab chiqarish QC ma'lumotlari o'zgartirilmaydi." });
    const qualityControl = {
      acceptedQuantity: parseQuantity(body.acceptedQuantity ?? body.accepted ?? 0, "Qabul qilingan miqdor"),
      defectQuantity: parseQuantity(body.defectQuantity ?? body.defect ?? 0, "Brak miqdori"),
      status: body.status || body.result || "PENDING",
      note: body.note || "",
      checkedAt: body.checkedAt || new Date().toISOString(),
    };
    const updated = await this.prisma.productionOrder.update({ where: { id, companyId: tenantId }, data: { qualityControl, acceptedQuantity: qualityControl.acceptedQuantity, defectQuantity: qualityControl.defectQuantity, qualityStatus: qualityControl.status, qualityNote: qualityControl.note }, include: { bom: { include: { materials: true } }, stages: true } });
    return this.productionOrderDto(updated);
  }

  async updateProductionOverhead(companyId: string, id: string, items: any[]) {
    const tenantId = this.requireCompany(companyId);
    const order = await this.prisma.productionOrder.findFirst({ where: { id, companyId: tenantId } });
    if (!order) throw new NotFoundException({ code: "PRODUCTION_NOT_FOUND", message: "Ishlab chiqarish topilmadi." });
    if (order.status === "COMPLETED" || order.status === "CANCELLED") throw new ConflictException({ code: "PRODUCTION_LOCKED", message: "Yakunlangan ishlab chiqarish xarajatlari faqat ko'rish uchun." });
    const overhead = this.normalizeOverheadItems(items);
    const updated = await this.prisma.productionOrder.update({ where: { id, companyId: tenantId }, data: { overheadItems: overhead.items, overheadCost: overhead.total, productionCost: roundMoney(toNumber(order.materialCost) + overhead.total) }, include: { bom: { include: { materials: true } }, stages: true } });
    return this.productionOrderDto(updated);
  }

  async getProductionOrder(companyId: string, id: string) {
    const order = await this.prisma.productionOrder.findFirst({ where: { id, companyId: this.requireCompany(companyId) }, include: { bom: { include: { materials: true } }, stages: true } });
    if (!order) throw new NotFoundException({ code: "PRODUCTION_NOT_FOUND", message: "Ishlab chiqarish topilmadi." });
    return this.productionOrderDto(order);
  }

  async listFinance(companyId: string, query: Record<string, string | undefined>) {
    const txns = await this.prisma.financeTransaction.findMany({
      where: { companyId: this.requireCompany(companyId), type: query.type as any || undefined, category: query.category || undefined },
      orderBy: { createdAt: "desc" },
      take: 300,
    });

    return { transactions: txns.map(this.financeDto), data: txns.map(this.financeDto) };
  }

  async createFinance(companyId: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const amount = roundMoney(body.amount);
    if (amount <= 0) throw new BadRequestException({ code: "INVALID_AMOUNT", message: "Summa 0 dan katta bo'lsin." });
    const input = {
      type: body.type || "OUT",
      amount,
      category: body.category || (body.type === "IN" ? "INCOME" : "EXPENSE"),
      method: body.method || body.paymentMethod || "CASH",
      sourceType: body.sourceType || "MANUAL",
      sourceId: body.sourceId || `manual:${Date.now()}`,
      idempotencyKey: body.idempotencyKey || body.id || `manual:${Date.now()}`,
      description: body.description || body.note,
      customerId: body.customerId,
      supplierId: body.supplierId,
      agentId: body.agentId,
      employeeId: body.employeeId,
      cashboxId: body.cashboxId,
    };
    const txn = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.financeTransaction.findUnique({
        where: { companyId_idempotencyKey: { companyId: tenantId, idempotencyKey: input.idempotencyKey } },
      });
      if (existing) return existing;

      const created = await this.createFinanceTx(tx, tenantId, input);
      if (input.sourceType === "CUSTOMER_PAYMENT" && input.type === "IN" && input.customerId) {
        const customer = await tx.customer.findFirst({ where: { id: input.customerId, companyId: tenantId, deletedAt: null } });
        if (!customer) throw new NotFoundException({ code: "CUSTOMER_NOT_FOUND", message: "Mijoz topilmadi." });
        if (amount > toNumber(customer.debtBalance)) throw new BadRequestException({ code: "OVERPAYMENT", message: "To'lov mijoz qarzidan oshmasin." });
        await tx.customer.update({ where: { id: customer.id, companyId: tenantId }, data: { debtBalance: { decrement: amount } } });
      }
      if (input.sourceType === "SUPPLIER_PAYMENT" && input.type === "OUT" && input.supplierId) {
        const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, companyId: tenantId, deletedAt: null } });
        if (!supplier) throw new NotFoundException({ code: "SUPPLIER_NOT_FOUND", message: "Yetkazib beruvchi topilmadi." });
        if (amount > toNumber(supplier.debtBalance)) throw new BadRequestException({ code: "OVERPAYMENT", message: "To'lov supplier qarzidan oshmasin." });
        await tx.supplier.update({ where: { id: supplier.id, companyId: tenantId }, data: { debtBalance: { decrement: amount } } });
      }
      return created;
    });

    return this.financeDto(txn);
  }

  async listCashboxes(companyId: string) {
    const boxes = await this.prisma.cashbox.findMany({ where: { companyId: this.requireCompany(companyId) }, orderBy: { createdAt: "asc" } });

    return { cashboxes: boxes.map(this.cashboxDto), data: boxes.map(this.cashboxDto) };
  }

  async listEmployees(companyId: string) {
    const employees = await this.prisma.employee.findMany({ where: { companyId: this.requireCompany(companyId), deletedAt: null }, orderBy: { createdAt: "desc" } });
    return { employees: employees.map(this.employeeDto), data: employees.map(this.employeeDto) };
  }

  async createEmployee(companyId: string, body: any) {
    const employee = await this.prisma.employee.create({
      data: {
        companyId: this.requireCompany(companyId),
        fullName: body.fullName || body.name,
        phone: body.phone,
        email: body.email,
        position: body.position || body.jobTitle,
        salary: roundMoney(body.salary),
        status: body.status || "ACTIVE",
      },
    });
    return this.employeeDto(employee);
  }

  async updateEmployee(companyId: string, id: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    await this.requireEmployee(tenantId, id);
    const employee = await this.prisma.employee.update({ where: { id, companyId: tenantId }, data: { fullName: body.fullName || body.name, phone: body.phone, email: body.email, position: body.position || body.jobTitle, salary: body.salary === undefined ? undefined : roundMoney(body.salary), status: body.status } });
    return this.employeeDto(employee);
  }

  async deleteEmployee(companyId: string, id: string) {
    const tenantId = this.requireCompany(companyId);
    await this.requireEmployee(tenantId, id);
    const payrolls = await this.prisma.payroll.count({ where: { employeeId: id, companyId: tenantId } });
    if (payrolls > 0) {
      await this.prisma.employee.update({ where: { id, companyId: tenantId }, data: { status: "INACTIVE", deletedAt: new Date() } });
      return { deleted: true, softDelete: true };
    }
    await this.prisma.employee.update({ where: { id, companyId: tenantId }, data: { status: "INACTIVE", deletedAt: new Date() } });
    return { deleted: true, softDelete: true };
  }

  async createPayroll(companyId: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    await this.requireEmployee(tenantId, body.employeeId);
    const gross = roundMoney(body.grossAmount || body.salary);
    const net = roundMoney(body.netAmount ?? gross + toNumber(body.bonuses) - toNumber(body.advances) - toNumber(body.penalties));
    const payroll = await this.prisma.payroll.create({
      data: {
        companyId: tenantId,
        employeeId: body.employeeId,
        period: body.period,
        grossAmount: gross,
        advances: toNumber(body.advances),
        bonuses: toNumber(body.bonuses),
        penalties: toNumber(body.penalties),
        netAmount: net,
        debtAmount: net,
        status: "DRAFT",
      },
    });
    return this.payrollDto(payroll);
  }

  async payPayroll(companyId: string, id: string, body: any, actorUserId?: string) {
    const tenantId = this.requireCompany(companyId);
    const amount = roundMoney(body.amount);
    const idempotencyKey = body.idempotencyKey || `payroll-payment:${id}:${amount}:${body.method || "CASH"}`;
    if (amount <= 0) throw new BadRequestException({ code: "INVALID_AMOUNT", message: "To'lov 0 dan katta bo'lsin." });

    return this.prisma.$transaction(async (tx) => {
      const existingPayment = await tx.financeTransaction.findUnique({
        where: { companyId_idempotencyKey: { companyId: tenantId, idempotencyKey } },
      });
      if (existingPayment) {
        const existingPayroll = await tx.payroll.findFirst({ where: { id, companyId: tenantId } });
        if (!existingPayroll) throw new NotFoundException({ code: "PAYROLL_NOT_FOUND", message: "Payroll topilmadi." });
        return this.payrollDto(existingPayroll);
      }

      const payroll = await tx.payroll.findFirst({ where: { id, companyId: tenantId } });
      if (!payroll) throw new NotFoundException({ code: "PAYROLL_NOT_FOUND", message: "Payroll topilmadi." });
      if (amount > toNumber(payroll.debtAmount)) throw new BadRequestException({ code: "OVERPAYMENT", message: "To'lov payroll qarzidan oshmasin." });
      const nextPaid = roundMoney(toNumber(payroll.paidAmount) + amount);
      const nextDebt = roundMoney(Math.max(toNumber(payroll.netAmount) - nextPaid, 0));
      const updated = await tx.payroll.update({
        where: { id, companyId: tenantId },
        data: { paidAmount: nextPaid, debtAmount: nextDebt, status: nextDebt <= 0 ? "PAID" : "PARTIAL" },
      });
      await this.createFinanceTx(tx, tenantId, {
        type: "OUT",
        amount,
        category: "PAYROLL_PAYMENT",
        sourceType: "PAYROLL_PAYMENT",
        sourceId: id,
        idempotencyKey,
        payrollId: id,
        employeeId: payroll.employeeId,
        method: body.method || "CASH",
        description: body.note || `Payroll ${payroll.period}`,
      });
      await this.writeAudit(tx, tenantId, actorUserId, "payroll.payment", "payroll", id, { amount, beforeDebt: payroll.debtAmount, afterDebt: nextDebt });
      return this.payrollDto(updated);
    });
  }

  async listPayroll(companyId: string) {
    const payrolls = await this.prisma.payroll.findMany({ where: { companyId: this.requireCompany(companyId) }, orderBy: { createdAt: "desc" } });
    return { payrolls: payrolls.map(this.payrollDto), data: payrolls.map(this.payrollDto) };
  }

  async reports(companyId: string) {
    const tenantId = this.requireCompany(companyId);
    const [sales, products, customers, suppliers, financeIn, financeOut, production, employees, expiredBatches, nearExpiryBatches] = await Promise.all([
      this.prisma.sale.aggregate({ where: { companyId: tenantId, status: "COMPLETED" }, _sum: { total: true, paidAmount: true, debtAmount: true, cogs: true, profit: true }, _count: true }),
      this.prisma.product.count({ where: { companyId: tenantId, deletedAt: null } }),
      this.prisma.customer.count({ where: { companyId: tenantId, deletedAt: null } }),
      this.prisma.supplier.count({ where: { companyId: tenantId, deletedAt: null } }),
      this.prisma.financeTransaction.aggregate({ where: { companyId: tenantId, type: "IN" }, _sum: { amount: true } }),
      this.prisma.financeTransaction.aggregate({ where: { companyId: tenantId, type: "OUT" }, _sum: { amount: true } }),
      this.prisma.productionOrder.count({ where: { companyId: tenantId, status: { not: "CANCELLED" } } }),
      this.prisma.employee.count({ where: { companyId: tenantId, status: "ACTIVE", deletedAt: null } }),
      this.prisma.batch.count({ where: { companyId: tenantId, status: "ACTIVE", remainingQuantity: { gt: 0 }, expiryDate: { lt: new Date() } } }),
      this.prisma.batch.count({ where: { companyId: tenantId, status: "ACTIVE", remainingQuantity: { gt: 0 }, expiryDate: { gte: new Date(), lte: new Date(Date.now() + 30 * 86_400_000) } } }),
    ]);

    return {
      sales: { count: sales._count, total: decimalToNumber(sales._sum.total), paid: decimalToNumber(sales._sum.paidAmount), debt: decimalToNumber(sales._sum.debtAmount), cogs: decimalToNumber(sales._sum.cogs), profit: decimalToNumber(sales._sum.profit) },
      inventory: { products, expiredBatches, nearExpiryBatches },
      crm: { customers, suppliers },
      finance: { income: decimalToNumber(financeIn._sum.amount), outcome: decimalToNumber(financeOut._sum.amount), net: decimalToNumber(financeIn._sum.amount) - decimalToNumber(financeOut._sum.amount) },
      manufacturing: { orders: production },
      hr: { employees },
    };
  }

  async dashboard(companyId: string) {
    return this.reports(companyId);
  }

  async getSettings(companyId: string, userId?: string) {
    const tenantId = this.requireCompany(companyId);
    const [companySettings, company] = await Promise.all([
      this.prisma.companySetting.findMany({ where: { companyId: tenantId } }),
      this.prisma.company.findUnique({ where: { id: tenantId }, select: { inventoryPolicy: true, currency: true } }),
    ]);
    const userSettings = userId ? await this.prisma.userSetting.findMany({ where: { userId, companyId: tenantId } }) : [];

    return {
      company: { ...Object.fromEntries(companySettings.map((item) => [item.key, item.value])), inventoryPolicy: company?.inventoryPolicy || "FEFO", currency: company?.currency || "UZS" },
      user: Object.fromEntries(userSettings.map((item) => [item.key, item.value])),
    };
  }

  async updateSettings(companyId: string, body: any, userId?: string) {
    const tenantId = this.requireCompany(companyId);
    const scope = body.scope || "company";
    const settings = body.settings || body.value || body;

    if (body.key === "inventory_policy" || settings?.inventoryPolicy || settings?.warehouse?.inventoryPolicy) {
      const policy = String(settings?.inventoryPolicy || settings?.warehouse?.inventoryPolicy || body.value || "FEFO").toUpperCase();
      if (!["FIFO", "FEFO"].includes(policy)) throw new BadRequestException({ code: "INVENTORY_POLICY_INVALID", message: "Ombor sarfi siyosati FIFO yoki FEFO bo'lishi kerak." });
      await this.prisma.company.update({ where: { id: tenantId }, data: { inventoryPolicy: policy } });
    }

    if (scope === "user" && userId) {
      await this.prisma.userSetting.upsert({
        where: { userId_companyId_key: { userId, companyId: tenantId, key: body.key || "platform" } },
        update: { value: settings },
        create: { userId, companyId: tenantId, key: body.key || "platform", value: settings },
      });
    } else {
      await this.prisma.companySetting.upsert({
        where: { companyId_key: { companyId: tenantId, key: body.key || "platform" } },
        update: { value: settings },
        create: { companyId: tenantId, key: body.key || "platform", value: settings },
      });
    }

    return this.getSettings(tenantId, userId);
  }

  private async changeStock(companyId: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const rawAmount = Number(body.quantity);
    if (!Number.isFinite(rawAmount) || rawAmount === 0) throw new BadRequestException({ code: "INVALID_QUANTITY", message: "Miqdor 0 dan katta bo'lsin." });
    const amount = rawAmount > 0 ? parseQuantity(rawAmount) : -parseQuantity(Math.abs(rawAmount));

    return this.prisma.$transaction(async (tx) => {
      await this.adjustStockDelta(tx, tenantId, body.warehouseId, body.productId, amount, {
        type: amount > 0 ? "IN" : "OUT",
        reason: body.reason,
        sourceType: body.sourceType || "MANUAL",
        sourceId: body.sourceId || `${Date.now()}`,
        idempotencyKey: body.idempotencyKey,
        note: body.note,
        cost: body.cost,
        batchNumber: body.batchNumber,
        expiryDate: body.expiryDate,
        productionDate: body.productionDate,
        receivedDate: body.receivedDate,
      });

      return this.listStock(tenantId, { warehouseId: body.warehouseId, productId: body.productId });
    });
  }

  private async adjustStockDelta(tx: Tx, companyId: string, warehouseId: string, productId: string, delta: number, movement: any): Promise<any[]> {
    if (!warehouseId || !productId) throw new BadRequestException({ code: "STOCK_TARGET_REQUIRED", message: "Ombor va mahsulot kerak." });
    await this.requireWarehouse(tx, companyId, warehouseId);
    if (movement.idempotencyKey) {
      const existingMovement = await tx.stockMovement.findUnique({ where: { companyId_idempotencyKey: { companyId, idempotencyKey: movement.idempotencyKey } } });
      if (existingMovement) return [];
    }
    const item = await this.ensureStockItem(tx, companyId, warehouseId, productId);
    const current = toNumber(item.quantity);
    const reserved = toNumber(item.reserved);
    if (delta < 0 && Math.abs(delta) > Math.max(current - reserved, 0)) {
      throw new ConflictException({ code: "INSUFFICIENT_AVAILABLE_STOCK", message: `Sotish uchun mavjud qoldiq yetarli emas. Mavjud: ${Math.max(current - reserved, 0)}.` });
    }
    const next = roundQuantity(current + delta);
    if (next < 0) throw new ConflictException({ code: "NEGATIVE_STOCK", message: `Yetarli qoldiq yo'q. Mavjud: ${current}.` });
    const product = await tx.product.findFirst({ where: { id: productId, companyId, deletedAt: null } });
    if (!product) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: "Mahsulot topilmadi." });
    if (delta < 0 && product.status !== "ACTIVE") {
      throw new ConflictException({ code: "PRODUCT_INACTIVE", message: "Faol bo'lmagan mahsulot sotilmaydi." });
    }

    const allocations: any[] = [];
    if (delta > 0) {
      const batch = await tx.batch.create({
        data: {
          companyId,
          batchNumber: movement.batchNumber || `${movement.sourceType || "MANUAL"}-${movement.sourceId || Date.now()}-${randomUUID().slice(0, 8)}`,
          productId,
          warehouseId,
          quantity: delta,
          remainingQuantity: delta,
          productionDate: movement.productionDate ? parseOptionalDate(movement.productionDate) : movement.sourceType === "PRODUCTION" ? new Date() : null,
          receivedDate: movement.receivedDate ? parseOptionalDate(movement.receivedDate) : new Date(),
          expiryDate: movement.expiryDate ? parseOptionalDate(movement.expiryDate) : product.expiryDate,
          unitCost: movement.cost === undefined ? toNumber(product.cost) : toNumber(movement.cost),
          sourceType: movement.sourceType || "MANUAL",
          sourceId: movement.sourceId || null,
        },
      });
      allocations.push({ batchId: batch.id, quantity: delta, unitCost: toNumber(batch.unitCost) });
      await tx.stockMovement.create({ data: this.stockMovementData(companyId, warehouseId, product, movement, delta, batch.id) });
    } else {
      await this.ensureLegacyBatchCoverage(tx, companyId, warehouseId, productId, current, product);
      const batches = await tx.batch.findMany({ where: { companyId, warehouseId, productId, status: "ACTIVE", remainingQuantity: { gt: 0 } } });
      const policy = await this.getInventoryPolicy(tx, companyId);
      batches.sort((left, right) => {
        if (policy === "FEFO") {
          const leftExpiry = left.expiryDate ? new Date(left.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
          const rightExpiry = right.expiryDate ? new Date(right.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
          if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;
        }
        return new Date(left.receivedDate || left.createdAt).getTime() - new Date(right.receivedDate || right.createdAt).getTime();
      });
      let remaining = Math.abs(delta);
      for (let index = 0; index < batches.length && remaining > 0; index += 1) {
        const batch = batches[index];
        const take = Math.min(remaining, toNumber(batch.remainingQuantity));
        if (take <= 0) continue;
        await tx.batch.update({ where: { id: batch.id }, data: { remainingQuantity: { decrement: take } } });
        const key = movement.idempotencyKey ? `${movement.idempotencyKey}:batch:${index}` : undefined;
        await tx.batchConsumption.create({ data: { companyId, batchId: batch.id, productId, warehouseId, quantity: take, unitCost: batch.unitCost, sourceType: movement.sourceType || "STOCK_OUT", sourceId: movement.sourceId || "", idempotencyKey: key } });
        await tx.stockMovement.create({ data: this.stockMovementData(companyId, warehouseId, product, movement, take, batch.id, index === 0 ? movement.idempotencyKey : key) });
        allocations.push({ batchId: batch.id, quantity: take, unitCost: toNumber(batch.unitCost) });
        remaining = roundQuantity(remaining - take);
      }
      if (remaining > 0) throw new ConflictException({ code: "BATCH_STOCK_MISMATCH", message: "Batch qoldig'i ombor qoldig'i bilan mos emas." });
    }
    await tx.stockItem.update({ where: { id: item.id }, data: { quantity: next, cost: movement.cost === undefined ? undefined : toNumber(movement.cost) } });
    await this.refreshProductStock(tx, companyId, productId);
    return allocations;
  }

  private stockMovementData(companyId: string, warehouseId: string, product: any, movement: any, quantity: number, batchId?: string, idempotencyKey?: string) {
    return {
      companyId,
      warehouseId,
      productId: product.id,
      productName: product.name,
      type: movement.type,
      quantity: Math.abs(quantity),
      unit: product.unit,
      cost: movement.cost === undefined ? product.cost : toNumber(movement.cost),
      reason: movement.reason,
      sourceType: movement.sourceType,
      sourceId: movement.sourceId,
      idempotencyKey: idempotencyKey || movement.idempotencyKey,
      note: movement.note,
      destinationWarehouseId: movement.destinationWarehouseId,
      sourceWarehouseId: movement.sourceWarehouseId,
      batchId,
    };
  }

  private async ensureLegacyBatchCoverage(tx: Tx, companyId: string, warehouseId: string, productId: string, currentQuantity: number, product: any) {
    const aggregate = await tx.batch.aggregate({ where: { companyId, warehouseId, productId, status: "ACTIVE" }, _sum: { remainingQuantity: true } });
    const missing = roundQuantity(currentQuantity - toNumber(aggregate._sum.remainingQuantity));
    if (missing > 0) {
      await tx.batch.create({ data: { companyId, batchNumber: `LEGACY-${productId}-${randomUUID().slice(0, 8)}`, productId, warehouseId, quantity: missing, remainingQuantity: missing, receivedDate: new Date(), expiryDate: product.expiryDate, unitCost: product.cost, sourceType: "LEGACY_STOCK", sourceId: productId } });
    }
  }

  private async getInventoryPolicy(client: Tx | PrismaService, companyId: string) {
    const company = await client.company.findUnique({ where: { id: companyId }, select: { inventoryPolicy: true } });
    return company?.inventoryPolicy === "FIFO" ? "FIFO" : "FEFO";
  }

  private async ensureStockItem(tx: Tx, companyId: string, warehouseId: string, productId: string) {
    return tx.stockItem.upsert({
      where: { companyId_warehouseId_productId: { companyId, warehouseId, productId } },
      update: {},
      create: {
        companyId,
        warehouseId,
        productId,
        quantity: 0,
        reserved: 0,
      },
    });
  }

 private async ensureCategory(
  tx: Tx,
  companyId: string,
  value: unknown,
) {
  const raw = String(value || "").trim();

  if (!raw) {
    return null;
  }

  const existing = await tx.category.findFirst({
    where: {
      companyId,
      OR: [
        { id: raw },
        {
          name: {
            equals: raw,
            mode: "insensitive",
          },
        },
      ],
    },
  });

  if (existing) {
    return existing.id;
  }

  const category = await tx.category.create({
    data: {
      companyId,
      name: raw,
      status: "ACTIVE",
    },
  });

  return category.id;
}

  private async ensureProduct(tx: Tx, companyId: string, productId: string | undefined, productName: unknown, type: string, unit: unknown) {
    if (productId) {
      const existing = await tx.product.findFirst({ where: { id: productId, companyId, deletedAt: null } });
      if (!existing) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: "Mahsulot topilmadi." });
      return existing;
    }
    const name = String(productName || "").trim();
    if (!name) throw new BadRequestException({ code: "PRODUCT_NAME_REQUIRED", message: "Mahsulot nomini kiriting." });
    const sku = String(1000 + (await tx.product.count({ where: { companyId } })) + 1);
    return tx.product.create({
      data: { companyId, name, sku, type, unit: normalizeUnit(unit), stock: 0 },
    });
  }

  private async requireWarehouse(client: Tx | PrismaService, companyId: string, warehouseId: string) {
    const warehouse = await client.warehouse.findFirst({ where: { id: warehouseId, companyId, status: "ACTIVE" } });
    if (!warehouse) throw new NotFoundException({ code: "WAREHOUSE_NOT_FOUND", message: "Ombor topilmadi." });
    return warehouse;
  }

  private async validateProductIds(client: Tx | PrismaService, companyId: string, ids: Array<string | null | undefined>) {
    const productIds = [...new Set(ids.filter(Boolean) as string[])];
    if (!productIds.length) return;

    const products = await client.product.findMany({
      where: { companyId, id: { in: productIds }, deletedAt: null },
      select: { id: true },
    });
    if (products.length !== productIds.length) {
      throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: "Bir yoki bir nechta mahsulot topilmadi." });
    }
  }

  private async validateFinanceReferences(tx: Tx, companyId: string, input: any) {
    const references: Array<[string, string | undefined, () => Promise<any>]> = [
      ["CUSTOMER_NOT_FOUND", input.customerId, () => tx.customer.findFirst({ where: { id: input.customerId, companyId } })],
      ["SUPPLIER_NOT_FOUND", input.supplierId, () => tx.supplier.findFirst({ where: { id: input.supplierId, companyId } })],
      ["AGENT_NOT_FOUND", input.agentId, () => tx.agent.findFirst({ where: { id: input.agentId, companyId } })],
      ["EMPLOYEE_NOT_FOUND", input.employeeId, () => tx.employee.findFirst({ where: { id: input.employeeId, companyId } })],
    ];

    for (const [code, id, find] of references) {
      if (id && !(await find())) {
        const messages: Record<string, string> = {
          CUSTOMER_NOT_FOUND: "Mijoz topilmadi.",
          SUPPLIER_NOT_FOUND: "Yetkazib beruvchi topilmadi.",
          AGENT_NOT_FOUND: "Agent topilmadi.",
          EMPLOYEE_NOT_FOUND: "Xodim topilmadi.",
        };
        throw new NotFoundException({ code, message: messages[code] || "Bog'langan ma'lumot topilmadi." });
      }
    }
  }

  private async refreshProductStock(tx: Tx, companyId: string, productId: string) {
    const aggregate = await tx.stockItem.aggregate({ where: { companyId, productId }, _sum: { quantity: true } });
    await tx.product.update({ where: { id: productId, companyId }, data: { stock: decimalToNumber(aggregate._sum.quantity) } });
  }

  private async ensureDefaultWarehouse(companyId: string) {
    const existing = await this.prisma.warehouse.findFirst({ where: { companyId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
    if (existing) return existing;
    return this.prisma.warehouse.create({ data: { companyId, name: "Asosiy ombor", code: "MAIN" } });
  }

  private async ensureDefaultCashbox(tx: Tx, companyId: string) {
    const existing = await tx.cashbox.findFirst({ where: { companyId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
    if (existing) return existing;
    return tx.cashbox.create({ data: { companyId, name: "Asosiy kassa", currency: "UZS" } });
  }

  private async createFinanceTx(tx: Tx, companyId: string, input: any) {
    if (input.amount <= 0) return null;
    const cashbox = input.cashboxId ? await tx.cashbox.findFirst({ where: { id: input.cashboxId, companyId, status: "ACTIVE" } }) : await this.ensureDefaultCashbox(tx, companyId);
    if (input.cashboxId && !cashbox) throw new NotFoundException({ code: "CASHBOX_NOT_FOUND", message: "Kassa topilmadi." });
    await this.validateFinanceReferences(tx, companyId, input);
    const existing = await tx.financeTransaction.findUnique({
      where: { companyId_idempotencyKey: { companyId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) return existing;

    const transaction = await tx.financeTransaction.create({
      data: {
        companyId,
        cashboxId: cashbox?.id,
        type: input.type,
        amount: input.amount,
        method: input.method,
        category: input.category,
        description: input.description,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        idempotencyKey: input.idempotencyKey,
        customerId: input.customerId,
        supplierId: input.supplierId,
        agentId: input.agentId,
        employeeId: input.employeeId,
        saleId: input.saleId,
        purchaseId: input.purchaseId,
        payrollId: input.payrollId,
      },
    });
    if (cashbox) {
      await tx.cashbox.update({
        where: { id: cashbox.id, companyId },
        data: { balance: { [input.type === "IN" ? "increment" : "decrement"]: input.amount } },
      });
    }
    return transaction;
  }

  private async generateSku(companyId: string) {
    const count = await this.prisma.product.count({ where: { companyId } });
    return String(1000 + count + 1);
  }

  private async writeAudit(client: Tx | PrismaService, companyId: string, actorUserId: string | undefined, action: string, targetType: string, targetId: string, metadata: any = {}) {
    return client.auditLog.create({
      data: {
        companyId,
        actorUserId: actorUserId || null,
        action,
        targetType,
        targetId,
        metadata,
      },
    });
  }

  private async generateNumber(tx: Tx | PrismaService, companyId: string, type: "sale" | "purchase" | "production") {
    const year = new Date().getFullYear();
    const prefix = type === "sale" ? "SO" : type === "purchase" ? "PO" : "MO";
    const count =
      type === "sale"
        ? await tx.sale.count({ where: { companyId } })
        : type === "purchase"
          ? await tx.purchase.count({ where: { companyId } })
          : await tx.productionOrder.count({ where: { companyId } });
    return `${prefix}-${year}-${String(count + 1).padStart(5, "0")}`;
  }

  private normalizePurchaseItems(items: any[], productMap = new Map<string, any>()) {
    if (!items.length) throw new BadRequestException({ code: "PURCHASE_ITEMS_REQUIRED", message: "Xarid itemlari kerak." });
    return items.map((item) => {
      const product = item.productId ? productMap.get(item.productId) : null;
      const purchaseQuantity = parseQuantity(item.quantity);
      const purchaseUnit = normalizeUnit(item.unit || product?.unit || "dona");
      const unit = product?.unit ? normalizeUnit(product.unit) : purchaseUnit;
      const conversionFactor = convertQuantity(1, purchaseUnit, unit);
      const quantity = roundQuantity(purchaseQuantity * conversionFactor);
      const purchaseCost = roundMoney(item.cost ?? item.price);
      const cost = roundMoney(conversionFactor > 0 ? purchaseCost / conversionFactor : purchaseCost);
      if (quantity <= 0) throw new BadRequestException({ code: "INVALID_QUANTITY", message: "Miqdor 0 dan katta bo'lsin." });
      return {
        productId: item.productId || null,
        productName: product?.name || item.productName || item.name || "Mahsulot",
        sku: product?.sku || item.sku || null,
        quantity,
        purchaseQuantity,
        purchaseUnit,
        unit,
        cost,
        salePrice: item.salePrice === undefined ? null : roundMoney(item.salePrice),
        subtotal: roundMoney(quantity * cost),
      };
    });
  }

  private normalizeOverheadItems(items: any) {
    const normalized = Array.isArray(items)
      ? items.map((item: any, index: number) => ({
        id: item.id || `overhead-${index + 1}`,
        type: item.type || "OTHER",
        name: String(item.name || item.label || item.type || "Boshqa xarajat").trim(),
        amount: roundMoney(item.amount ?? item.cost ?? item.value),
        note: item.note || "",
      })).filter((item: any) => item.amount > 0)
      : [];
    return {
      items: normalized,
      total: roundMoney(normalized.reduce((sum: number, item: any) => sum + item.amount, 0)),
    };
  }

  private normalizePackagingRows(input: any, unit: string) {
    const rows = Array.isArray(input) ? input : [];
    return rows.map((row: any, index: number) => ({
      id: row.id || `package-${index + 1}`,
      productId: row.productId || null,
      productName: String(row.productName || row.name || "").trim(),
      quantity: parseQuantity(row.quantity ?? row.count ?? 0, "Qadoq soni"),
      packSize: convertQuantity(parseQuantity(row.packSize ?? row.size ?? 0, "Qadoq hajmi"), row.packUnit || unit, unit),
      packUnit: normalizeUnit(row.packUnit || unit),
      materials: Array.isArray(row.materials || row.packagingMaterials) ? (row.materials || row.packagingMaterials).map((material: any) => ({ productId: material.productId, quantity: parseQuantity(material.quantity, "Qadoq materiali") })).filter((material: any) => material.productId && material.quantity > 0) : [],
    })).filter((row: any) => row.quantity > 0 && row.packSize > 0);
  }

  private async ensurePackagedVariant(tx: Tx, companyId: string, parentProductId: string, parentName: string, unit: string, row: any) {
    if (row.productId) {
      const existing = await tx.product.findFirst({ where: { id: row.productId, companyId, deletedAt: null } });
      if (!existing) throw new NotFoundException({ code: "PACKAGED_PRODUCT_NOT_FOUND", message: "Qadoqlangan SKU topilmadi." });
      return existing;
    }
    const name = row.productName || `${parentName} ${row.packSize} ${unit}`;
    const sku = `PKG-${parentProductId.slice(-8)}-${String(row.packSize).replace(".", "-")}`;
    return tx.product.upsert({
      where: { companyId_sku: { companyId, sku } },
      update: { status: "ACTIVE", parentProductId, packSize: row.packSize, packUnit: row.packUnit || unit, isVariant: true },
      create: { companyId, name, sku, type: "FINISHED_GOOD", unit, parentProductId, packSize: row.packSize, packUnit: row.packUnit || unit, isVariant: true, stock: 0 },
    });
  }

  private normalizeSalePayload(body: any) {
    const items = (body.items || []).map((item: any) => {
      const quantity = parseQuantity(item.quantity, "Savdo miqdori");
      const price = roundMoney(item.price ?? item.salePrice);
      if (!item.productId || quantity <= 0) throw new BadRequestException({ code: "INVALID_SALE_ITEM", message: "Mahsulot miqdori noto'g'ri." });
      return {
        productId: item.productId,
        productName: item.productName || item.name || "Mahsulot",
        sku: item.sku,
        barcode: item.barcode,
        quantity,
        unit: item.unit || "dona",
        price,
        cost: roundMoney(item.cost),
        subtotal: roundMoney(quantity * price),
      };
    });
    const payments = (body.payments || []).map((payment: any) => ({
      id: payment.id,
      method: payment.method || payment.paymentMethod || "CASH",
      amount: roundMoney(payment.amount),
    })).filter((payment: any) => payment.amount > 0 && payment.method !== "DEBT");
    const subtotal = roundMoney(items.reduce((sum: number, item: any) => sum + item.subtotal, 0));
    const discountValue = roundMoney(body.discountValue);
    const discount = body.discountType === "PERCENT" ? roundMoney(subtotal * discountValue / 100) : Math.min(discountValue, subtotal);
    const total = roundMoney(Math.max(subtotal - discount, 0));
    const paidAmount = roundMoney(payments.reduce((sum: number, payment: any) => sum + payment.amount, 0));
    const debtAmount = roundMoney(Math.max(total - paidAmount, 0));

    return {
      id: body.id,
      number: body.number,
      customerId: body.customerId || null,
      customerName: body.customerName || "",
      agentId: body.agentId || null,
      agentName: body.agentName || "",
      warehouseId: body.warehouseId || null,
      warehouseName: body.warehouseName || "",
      items,
      payments,
      subtotal,
      discountType: body.discountType === "PERCENT" ? "PERCENT" : "AMOUNT",
      discountValue,
      discount,
      total,
      paidAmount,
      debtAmount,
      paymentStatus: debtAmount <= 0 ? "PAID" : paidAmount > 0 ? "PARTIAL" : "UNPAID",
      paymentMethod: body.paymentMethod || payments[0]?.method || "",
      note: body.note,
      orderDate: parseOptionalDate(body.orderDate),
    };
  }

  private async applyProductUnits(client: Tx | PrismaService, companyId: string, items: any[]) {
    const products = await client.product.findMany({ where: { companyId, id: { in: items.map((item) => item.productId) }, deletedAt: null }, select: { id: true, name: true, sku: true, unit: true, cost: true } });
    const byId = new Map(products.map((product) => [product.id, product]));
    items.forEach((item) => {
      const product = byId.get(item.productId);
      if (product) Object.assign(item, { productName: product.name, sku: product.sku, unit: product.unit, cost: decimalToNumber(product.cost) });
    });
  }

  private saleCreateData(companyId: string, normalized: any, status: SaleStatus | "DRAFT" | "COMPLETED") {
    return {
      companyId,
      customerId: normalized.customerId,
      customerName: normalized.customerName,
      agentId: normalized.agentId,
      agentName: normalized.agentName,
      warehouseId: normalized.warehouseId,
      warehouseName: normalized.warehouseName,
      subtotal: normalized.subtotal,
      discountType: normalized.discountType,
      discountValue: normalized.discountValue,
      discount: normalized.discount,
      total: normalized.total,
      paidAmount: normalized.paidAmount,
      debtAmount: normalized.debtAmount,
      paymentStatus: normalized.paymentStatus,
      paymentMethod: normalized.paymentMethod,
      netTotal: normalized.total,
      status,
      note: normalized.note,
    };
  }

  private saleUpdateData(normalized: any, status: SaleStatus | "DRAFT" | "COMPLETED") {
    return {
      customerId: normalized.customerId,
      customerName: normalized.customerName,
      agentId: normalized.agentId,
      agentName: normalized.agentName,
      warehouseId: normalized.warehouseId,
      warehouseName: normalized.warehouseName,
      subtotal: normalized.subtotal,
      discountType: normalized.discountType,
      discountValue: normalized.discountValue,
      discount: normalized.discount,
      total: normalized.total,
      paidAmount: normalized.paidAmount,
      debtAmount: normalized.debtAmount,
      paymentStatus: normalized.paymentStatus,
      paymentMethod: normalized.paymentMethod,
      netTotal: normalized.total,
      status,
      note: normalized.note,
    };
  }

  private salePaymentCreateData(payments: any[]) {
    return payments.map((payment) => ({
      method: payment.method,
      amount: payment.amount,
    }));
  }

  private async requireEmployee(companyId: string, id: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id, companyId: this.requireCompany(companyId), deletedAt: null } });
    if (!employee) throw new NotFoundException({ code: "EMPLOYEE_NOT_FOUND", message: "Xodim topilmadi." });
    return employee;
  }

  private productDto(product: any) {
    const stockFromInventory = Array.isArray(product.stockItems)
      ? product.stockItems.reduce((sum: number, item: any) => sum + decimalToNumber(item.quantity), 0)
      : decimalToNumber(product.stock);
    const batchExpiry = product.batches?.filter((batch: any) => batch.expiryDate && decimalToNumber(batch.remainingQuantity) > 0).sort((left: any, right: any) => new Date(left.expiryDate).getTime() - new Date(right.expiryDate).getTime())[0]?.expiryDate || null;
    return {
      ...product,
      category: product.categoryRef?.name || product.category || null,
      categoryId: product.categoryRef?.id || product.categoryId || null,
      stock: stockFromInventory,
      minimumStock: decimalToNumber(product.minimumStock),
      reorderPoint: decimalToNumber(product.reorderPoint),
      cost: decimalToNumber(product.cost),
      salePrice: product.salePrice === null || product.salePrice === undefined ? null : decimalToNumber(product.salePrice),
      tax: decimalToNumber(product.tax),
      discount: decimalToNumber(product.discount),
      expiryDate: product.expiryDate || batchExpiry || null,
      normalWastePercent: product.normalWastePercent === null || product.normalWastePercent === undefined ? null : decimalToNumber(product.normalWastePercent),
      packSize: product.packSize === null || product.packSize === undefined ? null : decimalToNumber(product.packSize),
      supplierName: product.supplier?.name || product.supplierName || null,
    };
  }

  private batchDto(batch: any) {
    const expiryDays = batch.expiryDate ? Math.ceil((new Date(batch.expiryDate).getTime() - Date.now()) / 86_400_000) : null;
    return {
      ...batch,
      productName: batch.product?.name,
      warehouseName: batch.warehouse?.name,
      quantity: decimalToNumber(batch.quantity),
      remainingQuantity: decimalToNumber(batch.remainingQuantity),
      unitCost: decimalToNumber(batch.unitCost),
      expiryDays,
      expiryStatus: expiryDays === null ? null : expiryDays < 0 ? "expired" : expiryDays <= 30 ? "near_expiry" : "ok",
    };
  }

  private inventoryCountDto(count: any) {
    return { ...count, systemQuantity: decimalToNumber(count.systemQuantity), actualQuantity: decimalToNumber(count.actualQuantity), difference: decimalToNumber(count.difference) };
  }

  private supplierPriceDto(history: any) {
    return { ...history, supplierName: history.supplier?.name || null, productName: history.product?.name || null, price: decimalToNumber(history.price) };
  }

  private stockDto(stock: any) {
    const nearestExpiry = stock.product?.batches?.filter((batch: any) => batch.expiryDate)?.sort((left: any, right: any) => new Date(left.expiryDate).getTime() - new Date(right.expiryDate).getTime())[0]?.expiryDate || null;
    const expiryDays = nearestExpiry ? Math.ceil((new Date(nearestExpiry).getTime() - Date.now()) / 86_400_000) : null;
    return {
      id: stock.id,
      companyId: stock.companyId,
      warehouseId: stock.warehouseId,
      warehouseName: stock.warehouse?.name,
      productId: stock.productId,
      productName: stock.product?.name,
      sku: stock.product?.sku,
      unit: stock.product?.unit || "dona",
      quantity: decimalToNumber(stock.quantity),
      reserved: decimalToNumber(stock.reserved),
      cost: decimalToNumber(stock.cost),
      minimumStock: decimalToNumber(stock.minimumStock),
      reorderPoint: decimalToNumber(stock.product?.reorderPoint),
      expiryDate: nearestExpiry,
      expiryStatus: expiryDays === null ? null : expiryDays < 0 ? "expired" : expiryDays <= 30 ? "near_expiry" : "ok",
      expiryDays,
      isLowStock: decimalToNumber(stock.quantity) - decimalToNumber(stock.reserved) <= Math.max(decimalToNumber(stock.minimumStock), decimalToNumber(stock.product?.reorderPoint)),
      available: Math.max(decimalToNumber(stock.quantity) - decimalToNumber(stock.reserved), 0),
      createdAt: stock.createdAt,
      updatedAt: stock.updatedAt,
    };
  }

  private movementDto(movement: any) {
    return {
      ...movement,
      quantity: decimalToNumber(movement.quantity),
      cost: movement.cost === null || movement.cost === undefined ? null : decimalToNumber(movement.cost),
    };
  }

  private supplierDto(supplier: any) {
    return {
      ...supplier,
      debt: decimalToNumber(supplier.debtBalance),
      debtBalance: decimalToNumber(supplier.debtBalance),
    };
  }

  private purchaseDto(purchase: any) {
    return {
      ...purchase,
      subtotal: decimalToNumber(purchase.subtotal),
      total: decimalToNumber(purchase.total),
      paidAmount: decimalToNumber(purchase.paidAmount),
      debtAmount: decimalToNumber(purchase.debtAmount),
      items: purchase.items?.map((item: any) => ({
        ...item,
        quantity: decimalToNumber(item.quantity),
        purchaseQuantity: item.purchaseQuantity === null || item.purchaseQuantity === undefined ? null : decimalToNumber(item.purchaseQuantity),
        receivedQuantity: decimalToNumber(item.receivedQuantity),
        cost: decimalToNumber(item.cost),
        salePrice: item.salePrice === null || item.salePrice === undefined ? null : decimalToNumber(item.salePrice),
        subtotal: decimalToNumber(item.subtotal),
      })) || [],
    };
  }

  private saleDto(sale: any) {
    return {
      ...sale,
      subtotal: decimalToNumber(sale.subtotal),
      discountValue: decimalToNumber(sale.discountValue),
      discount: decimalToNumber(sale.discount),
      total: decimalToNumber(sale.total),
      paidAmount: decimalToNumber(sale.paidAmount),
      debtAmount: decimalToNumber(sale.debtAmount),
      returnedAmount: decimalToNumber(sale.returnedAmount),
      netTotal: decimalToNumber(sale.netTotal),
      cogs: decimalToNumber(sale.cogs),
      profit: decimalToNumber(sale.profit),
      items: sale.items?.map((item: any) => ({
        ...item,
        quantity: decimalToNumber(item.quantity),
        price: decimalToNumber(item.price),
        cost: decimalToNumber(item.cost),
        cogs: decimalToNumber(item.cogs),
        subtotal: decimalToNumber(item.subtotal),
      })) || [],
      payments: sale.payments?.map((payment: any) => ({
        ...payment,
        amount: decimalToNumber(payment.amount),
        paymentMethod: payment.method,
      })) || [],
      returns: sale.returns?.map((item: any) => ({
        ...item,
        quantity: decimalToNumber(item.quantity),
        refundAmount: decimalToNumber(item.refundAmount),
      })) || [],
    };
  }

  private customerDto(customer: any) {
    const sales = (customer.sales || []).filter((sale: any) => sale.status === "COMPLETED");
    const salesAmount = sales.reduce((sum: number, sale: any) => sum + decimalToNumber(sale.total), 0);
    const lastSale = sales[0] || null;
    return {
      ...customer,
      displayName: customer.name || customer.fullName || customer.companyName,
      agentName: customer.agent?.name || "",
      creditLimit: decimalToNumber(customer.creditLimit),
      debtAmount: decimalToNumber(customer.debtBalance),
      debtBalance: decimalToNumber(customer.debtBalance),
      salesAmount,
      salesCount: sales.length,
      averageCheck: sales.length ? roundMoney(salesAmount / sales.length) : 0,
      lastSale,
      credit: {
        creditLimit: decimalToNumber(customer.creditLimit),
        debtAmount: decimalToNumber(customer.debtBalance),
        availableCredit: Math.max(decimalToNumber(customer.creditLimit) - decimalToNumber(customer.debtBalance), 0),
        exceeded: decimalToNumber(customer.creditLimit) > 0 && decimalToNumber(customer.debtBalance) > decimalToNumber(customer.creditLimit),
      },
    };
  }

  private agentDto(agent: any) {
    const sales = (agent.sales || []).filter((sale: any) => sale.status === "COMPLETED");
    const salesAmount = sales.reduce((sum: number, sale: any) => sum + decimalToNumber(sale.total), 0);
    return {
      ...agent,
      fullName: agent.name,
      target: decimalToNumber(agent.targetAmount),
      targetAmount: decimalToNumber(agent.targetAmount),
      commission: decimalToNumber(agent.commissionRate),
      commissionRate: decimalToNumber(agent.commissionRate),
      balance: decimalToNumber(agent.balance),
      customersCount: agent.customers?.length || 0,
      salesCount: sales.length,
      salesAmount,
    };
  }

  private bomDto(bom: any) {
    return {
      ...bom,
      outputQuantity: decimalToNumber(bom.outputQuantity),
      quantity: decimalToNumber(bom.outputQuantity),
      overheadCost: decimalToNumber(bom.overheadCost),
      productId: bom.outputProductId,
      productName: bom.outputProduct?.name || bom.outputProductName,
      unit: bom.outputProduct?.unit || normalizeUnit(bom.unit),
      version: bom.version || 1,
      versionGroupId: bom.versionGroupId || bom.id,
      active: bom.status === "ACTIVE",
      normalWastePercent: bom.normalWastePercent === null || bom.normalWastePercent === undefined ? null : decimalToNumber(bom.normalWastePercent),
      materials: bom.materials?.map((item: any) => ({
        ...item,
        quantity: decimalToNumber(item.quantity),
        cost: decimalToNumber(item.cost),
      })) || [],
    };
  }

  private productionOrderDto(order: any) {
    const { actualQuantity, ...orderWithoutLegacyQuantity } = order;
    return {
      ...orderWithoutLegacyQuantity,
      plannedQuantity: decimalToNumber(order.plannedQuantity),
      producedQuantity: decimalToNumber(actualQuantity),
      actualQuantity: decimalToNumber(actualQuantity),
      acceptedQuantity: decimalToNumber(order.acceptedQuantity),
      defectQuantity: decimalToNumber(order.defectQuantity),
      wasteQuantity: decimalToNumber(order.wasteQuantity),
      yieldPercent: decimalToNumber(order.yieldPercent),
      wastePercent: decimalToNumber(order.wastePercent),
      normalWastePercent: order.bom?.normalWastePercent === null || order.bom?.normalWastePercent === undefined ? toNumber(order.recipeSnapshot?.normalWastePercent) || null : decimalToNumber(order.bom.normalWastePercent),
      abnormalWaste: (order.bom?.normalWastePercent !== null && order.bom?.normalWastePercent !== undefined ? decimalToNumber(order.bom.normalWastePercent) : toNumber(order.recipeSnapshot?.normalWastePercent)) > decimalToNumber(order.wastePercent),
      recipeVersion: order.recipeVersion || order.bom?.version || null,
      recipeSnapshot: order.recipeSnapshot || null,
      packaging: Array.isArray(order.packaging) ? order.packaging : [],
      remainingBulkQuantity: decimalToNumber(order.remainingBulkQuantity),
      materialCost: decimalToNumber(order.materialCost),
      overheadCost: decimalToNumber(order.overheadCost),
      productionCost: decimalToNumber(order.productionCost),
      unitCost: decimalToNumber(order.unitCost),
      actualMaterialCost: decimalToNumber(order.actualMaterialCost),
      actualProductionCost: decimalToNumber(order.actualProductionCost),
      actualUnitCost: decimalToNumber(order.actualUnitCost),
      overheadItems: Array.isArray(order.overheadItems) ? order.overheadItems : [],
      actualMaterials: Array.isArray(order.actualMaterials) ? order.actualMaterials : [],
      qualityControl: order.qualityControl || null,
      qualityStatus: order.qualityStatus || order.qualityControl?.status || null,
      qualityNote: order.qualityNote || order.qualityControl?.note || null,
      completionNote: order.completionNote || null,
      stages: order.stages?.map((stage: any) => ({ ...stage, status: stage.status === "PLANNED" ? "PENDING" : stage.status })) || [],
      productId: order.outputProductId,
      productName: order.outputProductName,
      requiredMaterials: order.bom?.materials?.map((material: any) => ({
        id: material.id,
        productId: material.productId,
        productName: material.productName,
        quantity: decimalToNumber(material.quantity),
        bomQuantity: decimalToNumber(material.quantity),
        requiredQuantity: decimalToNumber(material.quantity) * decimalToNumber(order.plannedQuantity) / Math.max(decimalToNumber(order.bom.outputQuantity), 1),
        unit: material.unit,
        cost: decimalToNumber(material.cost),
      })) || [],
      bom: order.bom ? this.bomDto(order.bom) : null,
    };
  }

  private financeDto(txn: any) {
    return {
      ...txn,
      amount: decimalToNumber(txn.amount),
    };
  }

  private cashboxDto(box: any) {
    return {
      ...box,
      balance: decimalToNumber(box.balance),
    };
  }

  private employeeDto(employee: any) {
    return {
      ...employee,
      name: employee.fullName,
      salary: decimalToNumber(employee.salary),
    };
  }

  private payrollDto(payroll: any) {
    return {
      ...payroll,
      grossAmount: decimalToNumber(payroll.grossAmount),
      advances: decimalToNumber(payroll.advances),
      bonuses: decimalToNumber(payroll.bonuses),
      penalties: decimalToNumber(payroll.penalties),
      netAmount: decimalToNumber(payroll.netAmount),
      paidAmount: decimalToNumber(payroll.paidAmount),
      debtAmount: decimalToNumber(payroll.debtAmount),
    };
  }
}
