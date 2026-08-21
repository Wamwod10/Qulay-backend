import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
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
  private readonly logger = new Logger(BusinessService.name);

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

    if (query.status) {
      const statuses = String(query.status).split(",").map((status) => status.trim()).filter(Boolean);
      where.status = statuses.length > 1 ? { in: statuses } : statuses[0];
    }
    if (query.type) where.type = query.type;
    const and: any[] = [];
    if (query.category) {
      and.push({
        OR: [
          { categoryId: query.category },
          { category: query.category },
        ],
      });
    }
    if (search) {
      and.push({
        OR: [
        { name: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
        { barcode: { contains: search, mode: "insensitive" } },
        ],
      });
    }
    if (and.length) {
      where.AND = and;
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
    if (!String(body.unit || "").trim()) throw new BadRequestException({ code: "PRODUCT_UNIT_REQUIRED", field: "unit", message: "O'lchov birligini tanlang." });
    const stock = parseQuantity(body.stock ?? 0, "Boshlang'ich qoldiq");
    const barcode = String(body.barcode || "").trim() || null;
    const [skuDuplicate, barcodeDuplicate] = await Promise.all([
      this.prisma.product.findFirst({ where: { companyId: tenantId, sku }, select: { id: true } }),
      barcode
        ? this.prisma.product.findFirst({ where: { companyId: tenantId, barcode }, select: { id: true } })
        : null,
    ]);
    if (skuDuplicate) throw new ConflictException({ code: "SKU_DUPLICATE", field: "sku", message: "Bu SKU boshqa mahsulotda mavjud." });
    if (barcodeDuplicate) throw new ConflictException({ code: "BARCODE_DUPLICATE", field: "barcode", message: "Bu shtrix-kod boshqa mahsulotda mavjud." });
    const warehouse = body.warehouseId
      ? await this.prisma.warehouse.findFirst({ where: { id: body.warehouseId, companyId: tenantId, status: "ACTIVE" } })
      : stock > 0
        ? await this.ensureDefaultWarehouse(tenantId)
        : null;
    if (body.warehouseId && !warehouse) throw new NotFoundException({ code: "WAREHOUSE_NOT_FOUND", message: "Ombor topilmadi." });
    if (body.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({ where: { id: body.supplierId, companyId: tenantId, deletedAt: null } });
      if (!supplier) throw new NotFoundException({ code: "SUPPLIER_NOT_FOUND", message: "Yetkazib beruvchi topilmadi." });
    }

    try {
  return await this.prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        companyId: tenantId,
        name,
        sku,
        barcode,
        type: body.type || null,
        category: body.category || null,
        categoryId: await this.ensureCategory(
          tx,
          tenantId,
          body.categoryId || body.category,
        ),
        brand: body.brand || null,
        unit: normalizeUnit(body.unit),
        stock: 0,
        minimumStock:
          body.minimumStock === undefined || body.minimumStock === ""
            ? 0
            : parseQuantity(body.minimumStock, "Minimal qoldiq"),
        reorderPoint:
          body.reorderPoint === undefined || body.reorderPoint === ""
            ? 0
            : parseQuantity(body.reorderPoint, "Qayta buyurtma nuqtasi"),
        cost: roundMoney(body.cost),
        salePrice:
          body.salePrice === null ||
          body.salePrice === "" ||
          body.salePrice === undefined
            ? null
            : roundMoney(body.salePrice),
        tax: roundMoney(body.tax),
        discount: roundMoney(body.discount),
        image: body.image || null,
        notes: body.notes || null,
        expiryDate: body.expiryDate
          ? parseOptionalDate(body.expiryDate)
          : null,
        normalWastePercent:
          body.normalWastePercent === undefined ||
          body.normalWastePercent === ""
            ? null
            : toNumber(body.normalWastePercent),
        parentProductId: body.parentProductId || null,
        packSize:
          body.packSize === undefined || body.packSize === ""
            ? null
            : parseQuantity(body.packSize, "Qadoq hajmi"),
        packUnit: body.packUnit || null,
        isVariant: Boolean(body.isVariant || body.parentProductId),
        supplierId: body.supplierId || null,
        status: body.status || "ACTIVE",
      },
    });

    if (stock > 0 && warehouse) {
      await this.adjustStockDelta(
        tx,
        tenantId,
        warehouse.id,
        product.id,
        stock,
        {
          type: "IN",
          reason: "OPENING_STOCK",
          sourceType: "PRODUCT",
          sourceId: product.id,
          cost: product.cost,
        },
      );
    }

    if (stock > 0 && warehouse) {
      await this.refreshProductStock(
        tx,
        tenantId,
        product.id,
      );
    }

    return this.productDto({
      ...product,
      stock: warehouse ? stock : 0,
    });
  });
} catch (error) {
  this.throwProductUniqueConflict(error);
}
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
    if (body.unit !== undefined && !String(body.unit || "").trim()) {
      throw new BadRequestException({ code: "PRODUCT_UNIT_REQUIRED", field: "unit", message: "O'lchov birligini tanlang." });
    }
    const nextSku = body.sku === undefined ? currentProduct.sku : String(body.sku || "").trim();
    const nextBarcode = body.barcode === undefined
      ? currentProduct.barcode
      : String(body.barcode || "").trim() || null;
    if (!nextSku) {
      throw new BadRequestException({ code: "PRODUCT_SKU_REQUIRED", field: "sku", message: "SKU kiriting." });
    }

    const [skuDuplicate, barcodeDuplicate] = await Promise.all([
      this.prisma.product.findFirst({ where: { companyId: tenantId, sku: nextSku, id: { not: id } }, select: { id: true } }),
      nextBarcode
        ? this.prisma.product.findFirst({ where: { companyId: tenantId, barcode: nextBarcode, id: { not: id } }, select: { id: true } })
        : null,
    ]);
    if (skuDuplicate) {
      throw new ConflictException({ code: "SKU_DUPLICATE", field: "sku", message: "Bu SKU boshqa mahsulotda mavjud." });
    }
    if (barcodeDuplicate) {
      throw new ConflictException({ code: "BARCODE_DUPLICATE", field: "barcode", message: "Bu shtrix-kod boshqa mahsulotda mavjud." });
    }
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
          message: "Qoldiq yoki tarix mavjud mahsulotning o'lchov birligini o'zgartirib bo'lmaydi. Yangi mahsulot yarating.",
        });
      }
    }
    if (body.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({ where: { id: body.supplierId, companyId: tenantId, deletedAt: null } });
      if (!supplier) throw new NotFoundException({ code: "SUPPLIER_NOT_FOUND", message: "Yetkazib beruvchi topilmadi." });
    }

let updated;

try {
  updated = await this.prisma.product.update({
    where: {
      id,
      companyId: tenantId,
    },
    data: {
      name: body.name,
      sku: body.sku === undefined ? undefined : nextSku,
      barcode: body.barcode === undefined ? undefined : nextBarcode,
      type: body.type,
      category: categoryName,
      categoryId,
      brand: body.brand,
      unit: body.unit === undefined ? undefined : nextUnit,

      minimumStock:
        body.minimumStock === undefined
          ? undefined
          : body.minimumStock === null || body.minimumStock === ""
            ? 0
            : parseQuantity(body.minimumStock, "Minimal qoldiq"),

      reorderPoint:
        body.reorderPoint === undefined
          ? undefined
          : body.reorderPoint === null || body.reorderPoint === ""
            ? 0
            : parseQuantity(
                body.reorderPoint,
                "Qayta buyurtma nuqtasi",
              ),

      cost:
        body.cost === undefined
          ? undefined
          : roundMoney(body.cost),

      salePrice:
        body.salePrice === undefined
          ? undefined
          : body.salePrice === null || body.salePrice === ""
            ? null
            : roundMoney(body.salePrice),

      tax:
        body.tax === undefined
          ? undefined
          : roundMoney(body.tax),

      discount:
        body.discount === undefined
          ? undefined
          : roundMoney(body.discount),

      image: body.image,
      notes: body.notes,

      expiryDate:
        body.expiryDate === undefined
          ? undefined
          : body.expiryDate
            ? parseOptionalDate(body.expiryDate)
            : null,

      normalWastePercent:
        body.normalWastePercent === undefined
          ? undefined
          : body.normalWastePercent === null ||
              body.normalWastePercent === ""
            ? null
            : toNumber(body.normalWastePercent),

      parentProductId: body.parentProductId,

      packSize:
        body.packSize === undefined
          ? undefined
          : body.packSize === null || body.packSize === ""
            ? null
            : parseQuantity(body.packSize, "Qadoq hajmi"),

      packUnit: body.packUnit,
      isVariant: body.isVariant,
      supplierId: body.supplierId,
      status: body.status,
    },
  });
} catch (error) {
  this.throwProductUniqueConflict(error);
}

if (body.cost !== undefined || body.salePrice !== undefined) {
  await this.writeAudit(
    this.prisma,
    tenantId,
    actorUserId,
    "product.price_change",
    "product",
    id,
    {
      before: {
        cost: currentProduct.cost,
        salePrice: currentProduct.salePrice,
      },
      after: {
        cost: body.cost,
        salePrice: body.salePrice,
      },
    },
  );
}

    return this.productDto(updated);
  }

  async changeProductStatus(companyId: string, id: string, status: string) {
    const tenantId = this.requireCompany(companyId);
    const nextStatus = String(status || "").toUpperCase();
    if (!["ACTIVE", "INACTIVE", "ARCHIVED"].includes(nextStatus)) {
      throw new BadRequestException({ code: "PRODUCT_STATUS_INVALID", message: "Mahsulot statusi noto'g'ri." });
    }

    const product = await this.prisma.product.findFirst({ where: { id, companyId: tenantId } });
    if (!product) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: "Mahsulot topilmadi." });

    const updated = await this.prisma.product.update({
      where: { id, companyId: tenantId },
      data: {
        status: nextStatus as any,
        deletedAt: nextStatus === "ARCHIVED" ? new Date() : null,
      },
    });

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
    const tenantId = this.requireCompany(companyId);
    const name = String(body.name || "").trim();
    const code = String(body.code || "").trim() || null;
    const status = String(body.status || "ACTIVE").toUpperCase();

    if (!name) throw new BadRequestException({ code: "WAREHOUSE_NAME_REQUIRED", message: "Ombor nomini kiriting." });
    if (!["ACTIVE", "INACTIVE", "ARCHIVED"].includes(status)) throw new BadRequestException({ code: "WAREHOUSE_STATUS_INVALID", message: "Ombor statusi noto'g'ri." });

    const duplicate = await this.prisma.warehouse.findFirst({
      where: {
        companyId: tenantId,
        OR: [
          { name: { equals: name, mode: "insensitive" } },
          ...(code ? [{ code: { equals: code, mode: Prisma.QueryMode.insensitive } }] : []),
        ],
      },
    });
    if (duplicate) throw new ConflictException({ code: "WAREHOUSE_DUPLICATE", message: "Bu nom yoki koddagi ombor allaqachon mavjud." });

    const warehouse = await this.prisma.warehouse.create({
      data: {
        companyId: tenantId,
        name,
        code,
        address: String(body.address || "").trim() || null,
        status: status as any,
      },
    });

    return warehouse;
  }

  async updateWarehouse(companyId: string, id: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id, companyId: tenantId } });
    if (!warehouse) throw new NotFoundException({ code: "WAREHOUSE_NOT_FOUND", message: "Ombor topilmadi." });

    const name = body.name === undefined ? warehouse.name : String(body.name || "").trim();
    const code = body.code === undefined ? warehouse.code : String(body.code || "").trim() || null;
    const status = body.status === undefined ? warehouse.status : String(body.status || "ACTIVE").toUpperCase();
    if (!name) throw new BadRequestException({ code: "WAREHOUSE_NAME_REQUIRED", message: "Ombor nomini kiriting." });
    if (!["ACTIVE", "INACTIVE", "ARCHIVED"].includes(status)) throw new BadRequestException({ code: "WAREHOUSE_STATUS_INVALID", message: "Ombor statusi noto'g'ri." });

    const duplicate = await this.prisma.warehouse.findFirst({
      where: {
        companyId: tenantId,
        id: { not: id },
        OR: [
          { name: { equals: name, mode: "insensitive" } },
          ...(code ? [{ code: { equals: code, mode: Prisma.QueryMode.insensitive } }] : []),
        ],
      },
    });
    if (duplicate) throw new ConflictException({ code: "WAREHOUSE_DUPLICATE", message: "Bu nom yoki koddagi ombor allaqachon mavjud." });

    return this.prisma.warehouse.update({
      where: { id, companyId: tenantId },
      data: {
        name,
        code,
        address: body.address === undefined ? undefined : String(body.address || "").trim() || null,
        status: status as any,
      },
    });
  }

  async deleteWarehouse(companyId: string, id: string) {
    const tenantId = this.requireCompany(companyId);
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id, companyId: tenantId } });
    if (!warehouse) throw new NotFoundException({ code: "WAREHOUSE_NOT_FOUND", message: "Ombor topilmadi." });

    const defaultWarehouse = await this.resolveDefaultWarehouse(tenantId, true);
    if (defaultWarehouse?.id === id) {
      throw new ConflictException({ code: "DEFAULT_WAREHOUSE_DELETE_BLOCKED", message: "Asosiy/default omborni o'chirib bo'lmaydi. Avval sozlamadan boshqa omborni default qiling." });
    }

    const [stockWithQuantity, movementCount, batchCount, purchaseCount, saleCount, inventoryCount] = await Promise.all([
      this.prisma.stockItem.count({ where: { companyId: tenantId, warehouseId: id, OR: [{ quantity: { gt: 0 } }, { reserved: { gt: 0 } }] } }),
      this.prisma.stockMovement.count({ where: { companyId: tenantId, warehouseId: id } }),
      this.prisma.batch.count({ where: { companyId: tenantId, warehouseId: id } }),
      this.prisma.purchase.count({ where: { companyId: tenantId, warehouseId: id } }),
      this.prisma.sale.count({ where: { companyId: tenantId, warehouseId: id } }),
      this.prisma.inventoryCount.count({ where: { companyId: tenantId, warehouseId: id } }),
    ]);

    if (stockWithQuantity > 0) {
      throw new ConflictException({ code: "WAREHOUSE_HAS_STOCK", message: "Bu omborni o'chirib bo'lmaydi, unda qoldiq mavjud." });
    }

    if (movementCount + batchCount + purchaseCount + saleCount + inventoryCount > 0) {
      const archived = await this.prisma.warehouse.update({ where: { id, companyId: tenantId }, data: { status: "ARCHIVED" } });
      return { deleted: true, softDelete: true, warehouse: archived };
    }

    await this.prisma.warehouse.delete({ where: { id, companyId: tenantId } });
    return { deleted: true, softDelete: false };
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
    throw new ConflictException({
      code: "CATEGORY_DUPLICATE",
      field: "name",
      message: "Bu kategoriya allaqachon mavjud.",
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
      include: { product: { include: { categoryRef: true, batches: { where: { status: "ACTIVE", remainingQuantity: { gt: 0 } }, orderBy: { expiryDate: "asc" } } } }, warehouse: true },
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

  async stockIn(companyId: string, body: any, actorUserId?: string) {
    return this.changeStock(companyId, {
      ...body,
      type: "IN",
      quantity: body.quantity,
      reason: body.source || body.reason || "MANUAL_IN",
    }, actorUserId);
  }

  async stockOut(companyId: string, body: any, actorUserId?: string) {
    return this.changeStock(companyId, {
      ...body,
      type: "OUT",
      quantity: body.quantity,
      reason: body.reason || "MANUAL_OUT",
    }, actorUserId);
  }

  async transferStock(companyId: string, body: any, actorUserId?: string) {
    const tenantId = this.requireCompany(companyId);
    const transferKey = body.idempotencyKey || `transfer:${body.fromWarehouseId}:${body.toWarehouseId}:${body.productId}:${Date.now()}`;

    const rawAmount = parseQuantity(body.quantity, "Ko'chirish miqdori");
    if (!rawAmount || rawAmount <= 0) throw new BadRequestException({ code: "INVALID_QUANTITY", message: "Miqdor 0 dan katta bo'lsin." });
    if (body.fromWarehouseId === body.toWarehouseId) throw new BadRequestException({ code: "SAME_WAREHOUSE", message: "Omborlar bir xil bo'lmasin." });

    return this.prisma.$transaction(async (tx) => {
      if (body.idempotencyKey) {
        const existing = await tx.stockMovement.findUnique({
          where: { companyId_idempotencyKey: { companyId: tenantId, idempotencyKey: `${transferKey}:out` } },
        });
        if (existing) return this.listStock(tenantId, {});
      }
      const product = await this.requireProduct(tx, tenantId, body.productId);
      const amount = this.convertToProductUnit(rawAmount, body.inputUnit || body.unit || product.unit, product.unit, "Ko'chirish miqdori");
      await this.requireWarehouse(tx, tenantId, body.fromWarehouseId);
      await this.requireWarehouse(tx, tenantId, body.toWarehouseId);
      await this.adjustStockDelta(tx, tenantId, body.fromWarehouseId, body.productId, -amount, {
        type: "TRANSFER_OUT",
        reason: "TRANSFER",
        sourceType: "TRANSFER",
        sourceId: transferKey,
        idempotencyKey: `${transferKey}:out`,
        note: body.note,
        destinationWarehouseId: body.toWarehouseId,
        actorUserId,
      });
      await this.adjustStockDelta(tx, tenantId, body.toWarehouseId, body.productId, amount, {
        type: "TRANSFER_IN",
        reason: "TRANSFER",
        sourceType: "TRANSFER",
        sourceId: transferKey,
        idempotencyKey: `${transferKey}:in`,
        note: body.note,
        sourceWarehouseId: body.fromWarehouseId,
        actorUserId,
      });

      await this.writeAudit(tx, tenantId, actorUserId, "stock.transfer", "product", body.productId, { sourceWarehouseId: body.fromWarehouseId, destinationWarehouseId: body.toWarehouseId, quantity: amount, unit: product.unit, note: body.note || null });
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
      include: { batch: true },
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
      if (body.idempotencyKey) {
        const existingMovement = await tx.stockMovement.findUnique({ where: { companyId_idempotencyKey: { companyId: tenantId, idempotencyKey: body.idempotencyKey } } });
        if (existingMovement) {
          const existingCount = await tx.inventoryCount.findFirst({ where: { companyId: tenantId, warehouseId: body.warehouseId, productId: body.productId }, orderBy: { createdAt: "desc" } });
          if (existingCount) return this.inventoryCountDto(existingCount);
        }
      }
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
          idempotencyKey: body.idempotencyKey || `inventory-count:${count.id}`,
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
    const tenantId = this.requireCompany(companyId);
    await this.getSupplier(companyId, id);
    const [purchases, history] = await Promise.all([
      this.prisma.purchase.count({ where: { supplierId: id, companyId: tenantId } }),
      this.prisma.supplierPriceHistory.count({ where: { supplierId: id, companyId: tenantId } }),
    ]);

    if (purchases > 0 || history > 0) {
      await this.prisma.supplier.update({ where: { id, companyId: tenantId }, data: { status: "INACTIVE", deletedAt: new Date() } });

      return { deleted: true, softDelete: true };
    }

    await this.prisma.supplier.delete({ where: { id, companyId: tenantId } });

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
    const tenantId = this.requireCompany(companyId);
    const purchase = await this.prisma.purchase.findFirst({
      where: { id, companyId: tenantId },
      include: { items: true, supplier: true, warehouse: true },
    });

    if (!purchase) throw new NotFoundException({ code: "PURCHASE_NOT_FOUND", message: "Xarid topilmadi." });

    const movements = await this.prisma.stockMovement.findMany({
      where: { companyId: tenantId, sourceType: "PURCHASE", sourceId: id },
      include: { batch: true },
      orderBy: { createdAt: "asc" },
    });

    const batches = movements
      .filter((movement) => movement.batch)
      .map((movement) => ({
        ...this.batchDto(movement.batch),
        movementId: movement.id,
        productId: movement.productId,
        movementQuantity: decimalToNumber(movement.quantity),
      }));

    return this.purchaseDto({ ...purchase, batches });
  }

  async createPurchase(companyId: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const productIds = Array.from(new Set<string>((body.items || []).map((item: any) => item.productId).filter(Boolean)));
    const productRecords = await this.prisma.product.findMany({ where: { companyId: tenantId, id: { in: productIds }, deletedAt: null } });
    await this.validateProductIds(this.prisma, tenantId, productIds);
    const items = this.normalizePurchaseItems(body.items || [], new Map(productRecords.map((product) => [product.id, product])));
    const total = roundMoney(items.reduce((sum, item) => sum + item.subtotal, 0));
    const requestedPaidAmount = roundMoney(body.paidAmount || body.payments?.reduce((sum: number, payment: any) => sum + toNumber(payment.amount), 0));
    if (requestedPaidAmount > 0) {
      throw new ConflictException({ code: "PURCHASE_NOT_RECEIVED", message: "To'lov qilishdan oldin xaridni qabul qiling." });
    }
    const paidAmount = 0;
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
          paidAmount: total === undefined ? undefined : 0,
          debtAmount: total === undefined ? undefined : 0,
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

      const company = await tx.company.findUnique({ where: { id: tenantId }, select: { currency: true } });
      const currency = normalizeCurrency(body.currency || company?.currency || "UZS");
      const receivedItems = Array.isArray(body.receivedItems)
        ? body.receivedItems
        : purchase.items.map((item) => ({
          productId: item.productId,
          purchaseItemId: item.id,
          quantity: Math.max(toNumber(item.purchaseQuantity ?? item.quantity) - convertQuantity(toNumber(item.receivedQuantity), item.unit, item.purchaseUnit || item.unit), 0),
          unit: item.purchaseUnit || item.unit,
        }));
      const receiveKey = body.idempotencyKey || `purchase-receive:${purchase.id}:${receivedItems.map((item: any) => `${item.purchaseItemId || item.productId}:${item.quantity}:${item.unit || ""}`).join(",")}`;
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
        const receiveUnit = normalizeUnit(received.unit || item.purchaseUnit || item.unit);
        const amount = roundQuantity(convertQuantity(parseQuantity(received.quantity ?? 0, "Qabul miqdori"), receiveUnit, item.unit));
        const remaining = toNumber(item.quantity) - toNumber(item.receivedQuantity);
        if (amount <= 0) continue;
        if (amount > remaining) throw new ConflictException({ code: "DUPLICATE_RECEIVE", message: "Qabul miqdori qoldiqdan oshmasin." });

        await tx.purchaseItem.update({ where: { id: item.id }, data: { receivedQuantity: { increment: amount } } });
        if (item.productId) {
          const receivedValue = roundMoney(amount * toNumber(item.cost), 6);
          await this.adjustStockDelta(tx, tenantId, warehouseId, item.productId, amount, {
            type: "IN",
            reason: "PURCHASE_RECEIVE",
            sourceType: "PURCHASE",
            sourceId: purchase.id,
            totalCost: receivedValue,
            batchNumber: received.batchNumber,
            expiryDate: received.expiryDate || body.expiryDate,
            productionDate: received.productionDate || body.productionDate,
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
              purchaseUnit: receiveUnit,
              purchaseQuantity: parseQuantity(received.quantity ?? 0, "Qabul miqdori"),
              canonicalUnit: item.unit,
              canonicalUnitPrice: item.cost,
              currency,
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

      const purchase = await tx.purchase.findFirst({ where: { id, companyId: tenantId }, include: { items: true } });
      if (!purchase) throw new NotFoundException({ code: "PURCHASE_NOT_FOUND", message: "Xarid topilmadi." });
      if (!["PARTIALLY_RECEIVED", "RECEIVED"].includes(purchase.status)) {
        throw new ConflictException({ code: "PURCHASE_NOT_RECEIVED", message: "Avval xaridni qabul qiling." });
      }
      if (amount > toNumber(purchase.debtAmount)) throw new BadRequestException({ code: "OVERPAYMENT", message: "To'lov qarz summasidan oshmasin." });
      const nextPaid = roundMoney(toNumber(purchase.paidAmount) + amount);
      const receivedTotal = roundMoney(
        purchase.items.reduce((sum, item) => sum + toNumber(item.receivedQuantity) * toNumber(item.cost), 0),
      );
      const nextDebt = roundMoney(Math.max(receivedTotal - nextPaid, 0));
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
    if (["PARTIALLY_RECEIVED", "RECEIVED"].includes(purchase.status)) throw new ConflictException({ code: "PURCHASE_RECEIVED", message: "Qabul qilingan xarid bekor qilinmaydi." });
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
    const boms = await this.prisma.bom.findMany({
      where: { companyId: this.requireCompany(companyId) },
      include: { materials: true, outputProduct: true },
      orderBy: [{ versionGroupId: "asc" }, { version: "desc" }],
    });

    const data = boms.map((bom) => this.bomDto(bom));
    return { boms: data, data };
  }

  async createBom(companyId: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const materials = Array.isArray(body.materials) ? body.materials : Array.isArray(body.items) ? body.items : [];
    if (!materials.length) throw new BadRequestException({ code: "RECIPE_MATERIALS_REQUIRED", message: "Retseptda kamida bitta xomashyo bo'lishi kerak." });
    const outputQuantity = parseQuantity(body.outputQuantity ?? body.quantity, "Chiqish miqdori");
    if (outputQuantity <= 0) throw new BadRequestException({ code: "INVALID_OUTPUT_QUANTITY", message: "Chiqish miqdori 0 dan katta bo'lishi kerak." });

    const bom = await this.prisma.$transaction(async (tx) => {
      const output = await this.ensureProduct(tx, tenantId, body.outputProductId || body.productId, body.outputProductName || body.productName, "FINISHED_GOOD", body.unit);
      const materialData: any[] = [];
      for (const item of materials) {
        const material = await this.ensureProduct(tx, tenantId, item.productId, item.productName || item.name, "RAW_MATERIAL", item.unit);
        const recipeMaterial = this.normalizeBomMaterial(material, item);
        convertQuantity(recipeMaterial.quantity, recipeMaterial.unit, material.unit);
        materialData.push({
          productId: material.id,
          productName: material.name,
          quantity: recipeMaterial.quantity,
          unit: recipeMaterial.unit,
          cost: recipeMaterial.cost,
        });
      }
      const created = await tx.bom.create({
        data: {
          companyId: tenantId,
          name: String(body.name || "Retsept").trim(),
          outputProductId: output.id,
          outputProductName: output.name,
          outputQuantity,
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
    if (!bom) throw new NotFoundException({ code: "RECIPE_NOT_FOUND", message: "Retsept topilmadi." });
    return this.bomDto(bom);
  }

  async updateBom(companyId: string, id: string, body: any, actorUserId?: string) {
    const tenantId = this.requireCompany(companyId);
    const current = await this.prisma.bom.findFirst({ where: { id, companyId: tenantId }, include: { materials: true } });
    if (!current) throw new NotFoundException({ code: "RECIPE_NOT_FOUND", message: "Retsept topilmadi." });
    const materials = Array.isArray(body.materials || body.items) ? (body.materials || body.items) : current.materials;
    if (!materials.length) throw new BadRequestException({ code: "RECIPE_MATERIALS_REQUIRED", message: "Retseptda kamida bitta xomashyo bo'lishi kerak." });
    const outputProduct = body.outputProductId || body.productId
      ? await this.prisma.product.findFirst({ where: { id: body.outputProductId || body.productId, companyId: tenantId, deletedAt: null } })
      : await this.prisma.product.findFirst({ where: { id: current.outputProductId || "", companyId: tenantId, deletedAt: null } });
    if ((body.outputProductId || body.productId) && !outputProduct) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: "Mahsulot topilmadi." });
    const outputQuantity = body.outputQuantity === undefined && body.quantity === undefined ? toNumber(current.outputQuantity) : parseQuantity(body.outputQuantity ?? body.quantity, "Chiqish miqdori");
    if (outputQuantity <= 0) throw new BadRequestException({ code: "INVALID_OUTPUT_QUANTITY", message: "Chiqish miqdori 0 dan katta bo'lishi kerak." });

    const materialProducts = await this.prisma.product.findMany({
      where: { companyId: tenantId, id: { in: materials.map((item: any) => item.productId).filter(Boolean) }, deletedAt: null },
    });
    const materialMap = new Map(materialProducts.map((product) => [product.id, product]));
    for (const item of materials) {
      const product = materialMap.get(item.productId);
      if (!product) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: `Retseptdagi "${item.productName || item.name || item.productId}" mahsuloti topilmadi. Retseptni yangilang.` });
      convertQuantity(parseQuantity(item.quantity, "Xomashyo miqdori"), item.unit || product.unit, product.unit);
    }

    const bom = await this.prisma.$transaction(async (tx) => {
      await tx.bom.update({ where: { id, companyId: tenantId }, data: { status: "INACTIVE" } });
      return tx.bom.create({
        data: {
          name: body.name || current.name,
          companyId: tenantId,
          outputProductId: outputProduct?.id || current.outputProductId,
          outputProductName: outputProduct?.name || body.outputProductName || body.productName || current.outputProductName,
          outputQuantity,
          unit: outputProduct?.unit || current.unit,
          overheadCost: body.overheadCost === undefined ? current.overheadCost : roundMoney(body.overheadCost),
          status: body.status || "ACTIVE",
          version: current.version + 1,
          versionGroupId: current.versionGroupId || current.id,
          normalWastePercent: body.normalWastePercent === undefined ? current.normalWastePercent : body.normalWastePercent === null || body.normalWastePercent === "" ? null : toNumber(body.normalWastePercent),
          materials: {
            create: materials.map((item: any) => {
              const product = materialMap.get(item.productId);
              const recipeMaterial = this.normalizeBomMaterial(product, item);
              return {
                productId: product?.id || null,
                productName: product?.name || item.productName || item.name || "Material",
                quantity: recipeMaterial.quantity,
                unit: recipeMaterial.unit,
                cost: recipeMaterial.cost,
              };
            }),
          },
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

  async listProductionOrders(companyId: string, query: Record<string, string | undefined> = {}) {
    const tenantId = this.requireCompany(companyId);
    const { page, limit, skip, take } = getPagination(Number(query.page), Number(query.limit || 50));
    const where: any = { companyId: tenantId };
    if (query.status) where.status = query.status;
    if (query.recipe || query.bomId) where.bomId = query.recipe || query.bomId;
    if (query.product || query.productId) where.outputProductId = query.product || query.productId;
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { number: { contains: search, mode: "insensitive" } },
        { outputProductName: { contains: search, mode: "insensitive" } },
      ];
    }
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = parseOptionalDate(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = parseOptionalDate(query.dateTo);
    }

    const [orders, total] = await this.prisma.$transaction([
      this.prisma.productionOrder.findMany({ where, include: { bom: { include: { materials: true, outputProduct: true } }, stages: true }, orderBy: { createdAt: "desc" }, skip, take }),
      this.prisma.productionOrder.count({ where }),
    ]);
    const data = orders.map((order) => this.safeProductionOrderDto(order));
    return { orders: data, productionOrders: data, data, meta: getPaginationMeta(page, limit, total) };
  }

  async getProductionMaterialAvailability(companyId: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const warehouseId = body.materialWarehouseId || body.warehouseId || (await this.ensureDefaultWarehouse(tenantId)).id;
    const plannedQuantity = parseQuantity(body.plannedQuantity ?? body.quantity, "Rejalashtirilgan miqdor");
    if (plannedQuantity <= 0) throw new BadRequestException({ code: "INVALID_PLANNED_QUANTITY", message: "Reja miqdori 0 dan katta bo'lishi kerak." });

    return this.prisma.$transaction(async (tx) => {
      await this.requireWarehouse(tx, tenantId, warehouseId);
      const recipeSnapshot = body.recipeSnapshot || await this.getRecipeSnapshot(tx, tenantId, body.bomId || body.recipeId);
      const requiredMaterials = await this.resolveProductionRequirements(tx, tenantId, recipeSnapshot, plannedQuantity);
      const materials = await this.getMaterialAvailabilityInTx(tx, tenantId, warehouseId, requiredMaterials);
      return {
        warehouseId,
        plannedQuantity,
        recipeSnapshot,
        materials,
        enough: materials.length > 0 && materials.every((item) => item.enough),
      };
    });
  }

  async createProductionOrder(companyId: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const defaultWarehouseId = (await this.ensureDefaultWarehouse(tenantId)).id;
    const materialWarehouseId = body.materialWarehouseId || body.warehouseId || defaultWarehouseId;
    const outputWarehouseId = body.outputWarehouseId || body.warehouseId || defaultWarehouseId;
    const plannedQuantity = parseQuantity(body.plannedQuantity ?? body.quantity, "Rejalashtirilgan miqdor");
    if (plannedQuantity <= 0) throw new BadRequestException({ code: "INVALID_PLANNED_QUANTITY", message: "Reja miqdori 0 dan katta bo'lishi kerak." });

    const company = await this.prisma.company.findFirst({ where: { id: tenantId }, select: { currency: true } });
    const overhead = this.normalizeOverheadItems(body.overheadItems);
    const order = await this.prisma.$transaction(async (tx) => {
      await this.requireWarehouse(tx, tenantId, materialWarehouseId);
      await this.requireWarehouse(tx, tenantId, outputWarehouseId);
      const recipeSnapshot = await this.getRecipeSnapshot(tx, tenantId, body.bomId || body.recipeId);
      const output = recipeSnapshot.outputProductId
        ? await tx.product.findFirst({ where: { id: recipeSnapshot.outputProductId, companyId: tenantId, deletedAt: null } })
        : null;
      if (!output) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: "Retseptdagi tayyor mahsulot topilmadi. Retseptni yangilang." });
      const requiredMaterials = await this.resolveProductionRequirements(tx, tenantId, recipeSnapshot, plannedQuantity);
      const availability = await this.getMaterialAvailabilityInTx(tx, tenantId, materialWarehouseId, requiredMaterials);
      const enough = availability.every((item) => item.enough);
      const requestedStages = Array.isArray(body.stages) ? body.stages : [];
      const stages = requestedStages.length ? requestedStages : ["Tayyorlash", "Ishlab chiqarish", "Sifat nazorati", "Qadoqlash"];
      const materialSnapshot = availability.map((item) => ({
        ...item,
        plannedQuantity: item.requiredQuantity,
        actualQuantity: item.requiredQuantity,
        reservedQuantity: 0,
        reservationStatus: enough ? "PENDING" : "SHORTAGE",
      }));
      const created = await tx.productionOrder.create({
        data: {
          companyId: tenantId,
          number: body.number || (await this.generateNumber(tx, tenantId, "production")),
          bomId: recipeSnapshot.id,
          outputProductId: output.id,
          outputProductName: output.name,
          unit: output.unit,
          plannedQuantity,
          warehouseId: materialWarehouseId,
          materialWarehouseId,
          outputWarehouseId,
          overheadCost: overhead.total || roundMoney(body.overheadCost ?? recipeSnapshot.overheadCost),
          overheadItems: overhead.items,
          recipeVersion: recipeSnapshot.version || null,
          recipeSnapshot,
          materialSnapshot,
          packaging: Array.isArray(body.packaging) ? body.packaging : [],
          currency: normalizeCurrency(body.currency ?? company?.currency ?? "UZS"),
          status: "PLANNED",
          note: body.note,
          plannedDate: parseOptionalDate(body.plannedDate),
          dueDate: parseOptionalDate(body.dueDate),
          priority: body.priority || null,
          responsible: body.responsible || body.responsibleEmployee || null,
          stages: {
            create: stages.map((stage: any, index: number) => ({
              name: stage.name || String(stage),
              sortOrder: Number.isFinite(Number(stage.sortOrder)) ? Number(stage.sortOrder) : index,
              status: stage.status === "PENDING" ? "PLANNED" : stage.status || "PLANNED",
              notes: stage.note || stage.notes || null,
            })),
          },
        },
        include: { bom: { include: { materials: true, outputProduct: true } }, stages: true },
      });

      if (enough) {
        const reservedSnapshot: any[] = [];
        for (const material of materialSnapshot) {
          await this.reserveStockInTx(tx, tenantId, {
            warehouseId: materialWarehouseId,
            productId: material.productId,
            quantity: material.requiredQuantity,
            unit: material.unit,
            sourceType: "PRODUCTION",
            sourceId: created.id,
          });
          reservedSnapshot.push({ ...material, reservedQuantity: material.requiredQuantity, reservationStatus: "RESERVED" });
        }
        return tx.productionOrder.update({
          where: { id: created.id, companyId: tenantId },
          data: { materialSnapshot: reservedSnapshot },
          include: { bom: { include: { materials: true, outputProduct: true } }, stages: true },
        });
      }

      return created;
    });
    return this.productionOrderDto(order);
  }

  async startProduction(companyId: string, id: string, body: any, actorUserId?: string) {
    const tenantId = this.requireCompany(companyId);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findFirst({ where: { id, companyId: tenantId }, include: { bom: { include: { materials: true, outputProduct: true } }, stages: true } });
      if (!order) throw new NotFoundException({ code: "PRODUCTION_NOT_FOUND", message: "Ishlab chiqarish topilmadi." });
      if (order.status === "IN_PROGRESS") throw new ConflictException({ code: "PRODUCTION_ALREADY_STARTED", message: "Ishlab chiqarish allaqachon boshlangan." });
      if (order.status === "COMPLETED" || order.status === "CANCELLED") throw new ConflictException({ code: "PRODUCTION_LOCKED", message: "Bu buyurtmani start qilib bo'lmaydi." });
      if (order.status !== "PLANNED") throw new ConflictException({ code: "PRODUCTION_STATE_INVALID", message: "Faqat rejalashtirilgan ishlab chiqarishni boshlash mumkin." });

      const materialWarehouseId = body.materialWarehouseId || body.warehouseId || order.materialWarehouseId || order.warehouseId || (await this.ensureDefaultWarehouse(tenantId)).id;
      const outputWarehouseId = body.outputWarehouseId || order.outputWarehouseId || order.warehouseId || materialWarehouseId;
      await this.requireWarehouse(tx, tenantId, materialWarehouseId);
      await this.requireWarehouse(tx, tenantId, outputWarehouseId);

      const recipeSnapshot = await this.ensureOrderRecipeSnapshot(tx, tenantId, order);
      const plannedQuantity = toNumber(order.plannedQuantity);
      const baseRequirements = Array.isArray(order.materialSnapshot) && (order.materialSnapshot as any[]).length
        ? (order.materialSnapshot as any[])
        : await this.resolveProductionRequirements(tx, tenantId, recipeSnapshot, plannedQuantity);
      const requirements = await this.normalizeSnapshotRequirements(tx, tenantId, baseRequirements, recipeSnapshot, plannedQuantity);
      const availability = await this.getMaterialAvailabilityInTx(tx, tenantId, materialWarehouseId, requirements);

      for (const material of availability) {
        const reservedQuantity = toNumber((requirements.find((item: any) => item.productId === material.productId) as any)?.reservedQuantity);
        const missingReservation = roundQuantity(material.requiredQuantity - reservedQuantity);
        if (missingReservation > 0) {
          if (missingReservation > material.availableQuantity) {
            throw new ConflictException({
              code: "INSUFFICIENT_AVAILABLE_STOCK",
              message: `${material.productName} yetarli emas. Kerak: ${missingReservation} ${material.unit}. Mavjud: ${material.availableQuantity} ${material.unit}.`,
              details: availability,
            });
          }
          await this.reserveStockInTx(tx, tenantId, {
            warehouseId: materialWarehouseId,
            productId: material.productId,
            quantity: missingReservation,
            unit: material.unit,
            sourceType: "PRODUCTION",
            sourceId: order.id,
          }, actorUserId);
        }
      }

      const claimed = await tx.productionOrder.updateMany({
        where: { id, companyId: tenantId, status: "PLANNED" },
        data: { status: "IN_PROGRESS", startedAt: new Date(), warehouseId: materialWarehouseId, materialWarehouseId, outputWarehouseId },
      });
      if (claimed.count !== 1) throw new ConflictException({ code: "PRODUCTION_STATE_CHANGED", message: "Ishlab chiqarish holati o'zgargan. Sahifani yangilang." });

      const materialSnapshot: any[] = [];
      let materialCost = 0;
      for (const material of requirements) {
        const qty = parseQuantity(material.requiredQuantity ?? material.plannedQuantity, "Reja xomashyo miqdori");
        const allocations = await this.consumeReservedStockInTx(tx, tenantId, {
          warehouseId: materialWarehouseId,
          productId: material.productId,
          quantity: qty,
          unit: material.unit,
          sourceType: "PRODUCTION",
          sourceId: order.id,
          reason: "PRODUCTION_START",
          idempotencyKey: `production-start:${order.id}:${material.productId}`,
        }, actorUserId);
        const actualCost = this.sumAllocationCost(allocations);
        const cost = qty > 0 ? roundMoney(actualCost / qty, 6) : toNumber(material.cost);
        materialCost += actualCost;
        materialSnapshot.push({
          ...material,
          plannedQuantity: qty,
          actualQuantity: qty,
          reservedQuantity: 0,
          consumedQuantity: qty,
          unit: material.unit,
          cost,
          actualCost: roundMoney(actualCost, 6),
          allocations,
          reservationStatus: "CONSUMED",
        });
      }

      const updated = await tx.productionOrder.update({
        where: { id, companyId: tenantId },
        data: {
          status: "IN_PROGRESS",
          materialCost: roundMoney(materialCost),
          productionCost: roundMoney(materialCost + toNumber(order.overheadCost)),
          materialSnapshot,
          recipeSnapshot,
          costingPolicy: "BATCH_ACTUAL",
        },
        include: { bom: { include: { materials: true, outputProduct: true } }, stages: true },
      });
      await this.writeAudit(tx, tenantId, actorUserId, "production.start", "production_order", order.id, { materialWarehouseId, outputWarehouseId, materialSnapshot });
      return this.productionOrderDto(updated);
    });
  }

  async completeProduction(companyId: string, id: string, body: any, actorUserId?: string) {
    const tenantId = this.requireCompany(companyId);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findFirst({ where: { id, companyId: tenantId }, include: { bom: { include: { materials: true, outputProduct: true } }, stages: true } });
      if (!order) throw new NotFoundException({ code: "PRODUCTION_NOT_FOUND", message: "Ishlab chiqarish topilmadi." });
      if (order.status === "COMPLETED") throw new ConflictException({ code: "PRODUCTION_ALREADY_COMPLETED", message: "Ishlab chiqarish allaqachon yakunlangan." });
      if (order.status === "CANCELLED") throw new ConflictException({ code: "PRODUCTION_CANCELLED", message: "Bekor qilingan buyurtma yakunlanmaydi." });
      if (order.status !== "IN_PROGRESS") throw new ConflictException({ code: "PRODUCTION_NOT_STARTED", message: "Avval ishlab chiqarishni boshlang." });
      if (!order.outputProductId) throw new BadRequestException({ code: "OUTPUT_PRODUCT_REQUIRED", message: "Tayyor mahsulot kerak." });

      const materialWarehouseId = body.materialWarehouseId || order.materialWarehouseId || order.warehouseId || (await this.ensureDefaultWarehouse(tenantId)).id;
      const outputWarehouseId = body.outputWarehouseId || order.outputWarehouseId || order.warehouseId || materialWarehouseId;
      await this.requireWarehouse(tx, tenantId, materialWarehouseId);
      await this.requireWarehouse(tx, tenantId, outputWarehouseId);

      const producedQuantity = parseQuantity(body.producedQuantity ?? body.actualQuantity ?? body.quantity ?? order.plannedQuantity, "Ishlab chiqarilgan miqdor");
      const quality = body.qualityControl || order.qualityControl || {};
      const acceptedQuantity = parseQuantity(body.acceptedQuantity ?? quality.acceptedQuantity ?? Math.max(producedQuantity - toNumber(body.defectQuantity ?? quality.defectQuantity) - toNumber(body.wasteQuantity ?? quality.wasteQuantity), 0), "Qabul qilingan miqdor");
      const defectQuantity = parseQuantity(body.defectQuantity ?? quality.defectQuantity ?? 0, "Brak miqdori");
      const wasteQuantity = parseQuantity(body.wasteQuantity ?? quality.wasteQuantity ?? 0, "Chiqindi miqdori");
      const packaging = this.normalizePackagingRows(body.packaging ?? order.packaging, order.unit);
      const packagedTotal = roundQuantity(packaging.reduce((sum, row) => sum + row.quantity * row.packSize, 0));
      if (packagedTotal > acceptedQuantity) throw new BadRequestException({ code: "PACKAGING_EXCEEDS_OUTPUT", message: "Qadoqlangan jami miqdor mavjud mahsulotdan oshmoqda." });

      const startedSnapshot = Array.isArray(order.materialSnapshot) ? order.materialSnapshot as any[] : [];
      const actualInput = Array.isArray(body.actualMaterials) ? body.actualMaterials : [];
      const actualByProduct = new Map<string, any>(actualInput.filter((item: any) => item.productId).map((item: any) => [item.productId, item] as [string, any]));
      const packagingMaterialIds = packaging.flatMap((row: any) => row.materials.map((material: any) => material.productId));
      const productIds = [...new Set([...startedSnapshot.map((item) => item.productId), ...actualInput.map((item: any) => item.productId), ...packagingMaterialIds].filter(Boolean))] as string[];
      const products = await tx.product.findMany({ where: { companyId: tenantId, id: { in: productIds }, deletedAt: null }, select: { id: true, name: true, unit: true, cost: true } });
      const productsById = new Map(products.map((product) => [product.id, product]));

      const materialEntries: any[] = [];
      let rawMaterialCost = 0;
      for (const planned of startedSnapshot) {
        if (!planned.productId) continue;
        const product = productsById.get(planned.productId);
        if (!product) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: `Retseptdagi "${planned.productName || planned.productId}" mahsuloti topilmadi. Retseptni yangilang.` });
        const plannedQuantity = parseQuantity(planned.plannedQuantity ?? planned.requiredQuantity ?? 0, "Reja xomashyo miqdori");
        const entered = actualByProduct.get(planned.productId);
        const actualMaterialQuantity = parseQuantity(entered?.actualQuantity ?? entered?.quantity ?? plannedQuantity, "Haqiqiy xomashyo miqdori");
        const delta = roundQuantity(actualMaterialQuantity - plannedQuantity);
        let actualCost = toNumber(planned.actualCost);
        const plannedUnitCost = plannedQuantity > 0 ? actualCost / plannedQuantity : toNumber(planned.cost ?? product.cost);
        let deltaAllocations: any[] = [];
        if (delta > 0) {
          deltaAllocations = await this.adjustStockDelta(tx, tenantId, materialWarehouseId, planned.productId, -delta, {
            type: "CONSUME",
            reason: "PRODUCTION_ACTUAL_EXTRA",
            sourceType: "PRODUCTION",
            sourceId: order.id,
            idempotencyKey: `production-material-extra:${order.id}:${planned.productId}`,
          });
          actualCost += this.sumAllocationCost(deltaAllocations);
        } else if (delta < 0) {
          const returned = Math.abs(delta);
          await this.adjustStockDelta(tx, tenantId, materialWarehouseId, planned.productId, returned, {
            type: "IN",
            reason: "PRODUCTION_UNUSED_RETURN",
            sourceType: "PRODUCTION_RETURN",
            sourceId: order.id,
            idempotencyKey: `production-material-return:${order.id}:${planned.productId}`,
            cost: plannedUnitCost,
            batchNumber: `RETURN-${order.number}-${planned.productId.slice(-4)}`,
          });
          actualCost = Math.max(actualCost - returned * plannedUnitCost, 0);
        }
        rawMaterialCost += actualCost;
        materialEntries.push({
          ...planned,
          productName: planned.productName || product.name,
          actualQuantity: actualMaterialQuantity,
          plannedQuantity,
          difference: roundQuantity(actualMaterialQuantity - plannedQuantity),
          differencePercent: plannedQuantity > 0 ? roundMoney(((actualMaterialQuantity - plannedQuantity) / plannedQuantity) * 100, 4) : 0,
          unit: product.unit,
          cost: actualMaterialQuantity > 0 ? roundMoney(actualCost / actualMaterialQuantity, 6) : plannedUnitCost,
          actualCost: roundMoney(actualCost, 6),
          deltaAllocations,
        });
      }
      for (const entered of actualInput) {
        if (!entered.productId || startedSnapshot.some((item) => item.productId === entered.productId)) continue;
        const product = productsById.get(entered.productId);
        if (!product) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: `Qo'shimcha xomashyo (${entered.productId}) topilmadi.` });
        const actualMaterialQuantity = this.convertToProductUnit(entered.actualQuantity ?? entered.quantity, entered.unit || product.unit, product.unit, "Qo'shimcha xomashyo miqdori");
        const allocations = actualMaterialQuantity > 0
          ? await this.adjustStockDelta(tx, tenantId, materialWarehouseId, entered.productId, -actualMaterialQuantity, {
            type: "CONSUME",
            reason: "PRODUCTION_ADDITIONAL_CONSUMPTION",
            sourceType: "PRODUCTION",
            sourceId: order.id,
            idempotencyKey: `production-additional-material:${order.id}:${entered.productId}`,
          })
          : [];
        const actualCost = this.sumAllocationCost(allocations);
        rawMaterialCost += actualCost;
        materialEntries.push({ productId: entered.productId, productName: product.name, actualQuantity: actualMaterialQuantity, plannedQuantity: 0, difference: actualMaterialQuantity, differencePercent: 0, unit: product.unit, cost: actualMaterialQuantity > 0 ? roundMoney(actualCost / actualMaterialQuantity, 6) : toNumber(product.cost), actualCost, allocations, additional: true });
      }

      const packageMaterialCosts = new Map<string, number>();
      let packagingMaterialCost = 0;
      for (const [index, row] of packaging.entries()) {
        let rowCost = 0;
        for (const material of row.materials) {
          const product = productsById.get(material.productId);
          if (!product) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: `Qadoqlash materiali (${material.productId}) topilmadi.` });
          const totalMaterialQuantity = this.convertToProductUnit(roundQuantity(material.quantity * row.quantity), material.unit || product.unit, product.unit, "Qadoqlash materiali");
          if (totalMaterialQuantity > 0) {
            const allocations = await this.adjustStockDelta(tx, tenantId, materialWarehouseId, material.productId, -totalMaterialQuantity, {
              type: "CONSUME",
              reason: "PACKAGING_MATERIAL",
              sourceType: "PRODUCTION_PACKAGING",
              sourceId: order.id,
              idempotencyKey: `production-packaging-material:${order.id}:${index}:${material.productId}`,
            });
            rowCost += this.sumAllocationCost(allocations);
          }
        }
        packageMaterialCosts.set(row.id, rowCost);
        packagingMaterialCost += rowCost;
      }

      const overhead = this.normalizeOverheadItems(Array.isArray(body.overheadItems) ? body.overheadItems : order.overheadItems);
      const overheadCost = overhead.items.length ? overhead.total : roundMoney(body.overheadCost ?? order.overheadCost);
      const baseProductionCost = roundMoney(rawMaterialCost + overheadCost, 6);
      const actualProductionCost = roundMoney(baseProductionCost + packagingMaterialCost, 6);
      const baseUnitCost = acceptedQuantity > 0 ? baseProductionCost / acceptedQuantity : 0;
      const actualUnitCost = acceptedQuantity > 0 ? roundMoney(actualProductionCost / acceptedQuantity, 6) : 0;
      const bulkQuantity = roundQuantity(acceptedQuantity - packagedTotal);
      const lotNumber = body.batchNumber || `MFG-${order.number}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
      if (bulkQuantity > 0) {
        await this.adjustStockDelta(tx, tenantId, outputWarehouseId, order.outputProductId, bulkQuantity, {
          type: "PRODUCE",
          reason: packagedTotal > 0 ? "PRODUCTION_BULK_REMAINING" : "PRODUCTION_COMPLETE",
          sourceType: "PRODUCTION",
          sourceId: order.id,
          idempotencyKey: `production-output:${order.id}`,
          cost: baseUnitCost,
          batchNumber: lotNumber,
          expiryDate: body.expiryDate,
          productionDate: new Date(),
        });
      }
      const packagedRows: any[] = [];
      for (const [index, row] of packaging.entries()) {
        const variant = await this.ensurePackagedVariant(tx, tenantId, order.outputProductId, order.outputProductName || "Tayyor mahsulot", order.unit, row);
        const rowPackagingCost = packageMaterialCosts.get(row.id) || 0;
        const perPackPackagingCost = row.quantity > 0 ? rowPackagingCost / row.quantity : 0;
        const packUnitCost = roundMoney(baseUnitCost * row.packSize + perPackPackagingCost, 6);
        await this.adjustStockDelta(tx, tenantId, outputWarehouseId, variant.id, row.quantity, {
          type: "PRODUCE",
          reason: "PRODUCTION_PACKAGING",
          sourceType: "PRODUCTION_PACKAGING",
          sourceId: order.id,
          idempotencyKey: `production-package:${order.id}:${index}`,
          cost: packUnitCost,
          batchNumber: `${lotNumber}-PKG-${index + 1}`,
          expiryDate: body.expiryDate,
          productionDate: new Date(),
        });
        packagedRows.push({ ...row, productId: variant.id, productName: variant.name, unit: "dona", packagingMaterialCost: roundMoney(rowPackagingCost, 6), unitCost: packUnitCost });
      }

      const yieldPercent = toNumber(order.plannedQuantity) > 0 ? roundMoney((acceptedQuantity / toNumber(order.plannedQuantity)) * 100, 4) : 0;
      const wastePercent = producedQuantity > 0 ? roundMoney((wasteQuantity / producedQuantity) * 100, 4) : 0;
      const normalWastePercent = this.getSnapshotNormalWastePercent(order);
      const qualityControl = {
        status: body.qualityStatus || quality.status || quality.result || "PASS",
        producedQuantity,
        acceptedQuantity,
        defectQuantity,
        wasteQuantity,
        note: body.qualityNote || quality.note || "",
        checkedAt: quality.checkedAt || new Date().toISOString(),
        inspector: quality.inspector || body.inspector || null,
        yieldPercent,
        wastePercent,
        normalWastePercent,
        abnormalWastePercent: normalWastePercent === null ? 0 : roundMoney(Math.max(wastePercent - normalWastePercent, 0), 4),
      };
      const updated = await tx.productionOrder.update({
        where: { id, companyId: tenantId },
        data: {
          status: "COMPLETED",
          actualQuantity: producedQuantity,
          acceptedQuantity,
          defectQuantity,
          wasteQuantity,
          yieldPercent,
          wastePercent,
          packaging: packagedRows,
          remainingBulkQuantity: bulkQuantity,
          actualMaterials: materialEntries,
          actualMaterialCost: roundMoney(rawMaterialCost + packagingMaterialCost, 6),
          actualProductionCost,
          actualUnitCost,
          overheadItems: overhead.items,
          overheadCost,
          materialCost: roundMoney(rawMaterialCost),
          productionCost: roundMoney(actualProductionCost),
          unitCost: roundMoney(actualUnitCost),
          qualityControl,
          qualityStatus: qualityControl.status,
          qualityNote: qualityControl.note,
          completionNote: body.completionNote || body.note || undefined,
          materialWarehouseId,
          outputWarehouseId,
          warehouseId: materialWarehouseId,
          costingPolicy: "BATCH_ACTUAL",
          completedAt: new Date(),
        },
        include: { bom: { include: { materials: true, outputProduct: true } }, stages: true },
      });
      await this.writeAudit(tx, tenantId, actorUserId, "production.complete", "production_order", order.id, { producedQuantity, acceptedQuantity, packaging: packagedRows, yieldPercent, wastePercent, rawMaterialCost, packagingMaterialCost, overheadCost, actualProductionCost, outputWarehouseId });
      return this.productionOrderDto(updated);
    });
  }

  async cancelProduction(companyId: string, id: string, body: any = {}, actorUserId?: string) {
    const tenantId = this.requireCompany(companyId);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findFirst({ where: { id, companyId: tenantId }, include: { bom: { include: { materials: true, outputProduct: true } }, stages: true } });
      if (!order) throw new NotFoundException({ code: "PRODUCTION_NOT_FOUND", message: "Ishlab chiqarish topilmadi." });
      if (order.status === "COMPLETED") throw new ConflictException({ code: "PRODUCTION_COMPLETED", message: "Yakunlangan ishlab chiqarish bekor qilinmaydi." });
      if (order.status === "CANCELLED") return this.productionOrderDto(order);
      const warehouseId = order.materialWarehouseId || order.warehouseId;
      if (warehouseId && Array.isArray(order.materialSnapshot)) {
        for (const material of order.materialSnapshot as any[]) {
          if (!material.productId) continue;
          const reservedQuantity = toNumber(material.reservedQuantity);
          if (order.status === "PLANNED" && reservedQuantity > 0) {
            await this.releaseReservationInTx(tx, tenantId, { warehouseId, productId: material.productId, quantity: reservedQuantity, unit: material.unit, sourceType: "PRODUCTION", sourceId: order.id }, actorUserId);
          }
          const consumedQuantity = toNumber(material.consumedQuantity || material.actualQuantity);
          if (order.status === "IN_PROGRESS" && consumedQuantity > 0) {
            await this.adjustStockDelta(tx, tenantId, warehouseId, material.productId, consumedQuantity, {
              type: "IN",
              reason: "PRODUCTION_CANCEL_RETURN",
              sourceType: "PRODUCTION_CANCEL",
              sourceId: order.id,
              note: body.reason,
              idempotencyKey: `production-cancel:${order.id}:${material.productId}`,
              cost: material.cost,
              batchNumber: `CANCEL-${order.number}-${material.productId.slice(-4)}`,
            });
          }
        }
      }
      const updated = await tx.productionOrder.update({
        where: { id, companyId: tenantId },
        data: { status: "CANCELLED", cancelledAt: new Date(), note: [order.note, body.reason].filter(Boolean).join(" | ") || undefined },
        include: { bom: { include: { materials: true, outputProduct: true } }, stages: true },
      });
      await this.writeAudit(tx, tenantId, actorUserId, "production.cancel", "production_order", order.id, { reason: body.reason || null });
      return this.productionOrderDto(updated);
    });
  }

  private async getRecipeSnapshot(tx: Tx, companyId: string, bomId: string | undefined) {
    if (!bomId) throw new BadRequestException({ code: "RECIPE_REQUIRED", message: "Retsept tanlang." });
    const bom = await tx.bom.findFirst({
      where: { id: bomId, companyId },
      include: { materials: true, outputProduct: true },
    });
    if (!bom) throw new NotFoundException({ code: "RECIPE_NOT_FOUND", message: "Retsept topilmadi." });
    if (bom.status !== "ACTIVE") throw new ConflictException({ code: "RECIPE_INACTIVE", message: "Retsept faol emas." });
    if (!bom.outputProduct) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: "Retseptdagi tayyor mahsulot topilmadi. Retseptni yangilang." });
    const outputQuantity = parseQuantity(bom.outputQuantity, "Retsept chiqish miqdori");
    if (outputQuantity <= 0) throw new BadRequestException({ code: "INVALID_OUTPUT_QUANTITY", message: "Retsept chiqish miqdori 0 dan katta bo'lishi kerak." });
    const productIds = bom.materials.map((material) => material.productId).filter(Boolean) as string[];
    const products = await tx.product.findMany({
      where: { companyId, id: { in: productIds }, deletedAt: null },
      select: { id: true, name: true, sku: true, unit: true, cost: true },
    });
    const productMap = new Map(products.map((product) => [product.id, product]));
    const materials = bom.materials.map((material: any) => {
      const product = material.productId ? productMap.get(material.productId) : null;
      if (!product) {
        throw new NotFoundException({
          code: "PRODUCTION_MATERIAL_NOT_FOUND",
          message: `Retseptdagi "${material.productName || material.productId}" mahsuloti topilmadi. Retseptni yangilang.`,
        });
      }
      const recipeUnit = normalizeUnit(material.unit || product.unit);
      const canonicalQuantity = roundQuantity(convertQuantity(material.quantity, recipeUnit, product.unit));
      return {
        recipeMaterialId: material.id,
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: decimalToNumber(material.quantity),
        unit: recipeUnit,
        canonicalQuantity,
        canonicalUnit: product.unit,
        cost: decimalToNumber(material.cost),
        currentUnitCost: decimalToNumber(product.cost),
      };
    });
    return {
      id: bom.id,
      version: bom.version,
      versionGroupId: bom.versionGroupId || bom.id,
      name: bom.name,
      outputProductId: bom.outputProduct.id,
      outputProductName: bom.outputProduct.name,
      outputQuantity,
      outputUnit: bom.outputProduct.unit,
      unit: bom.outputProduct.unit,
      overheadCost: decimalToNumber(bom.overheadCost),
      normalWastePercent: bom.normalWastePercent === null || bom.normalWastePercent === undefined ? null : decimalToNumber(bom.normalWastePercent),
      materials,
    };
  }

  private async ensureOrderRecipeSnapshot(tx: Tx, companyId: string, order: any) {
    if (order.recipeSnapshot && typeof order.recipeSnapshot === "object") return order.recipeSnapshot as any;
    const snapshot = await this.getRecipeSnapshot(tx, companyId, order.bomId);
    await tx.productionOrder.update({ where: { id: order.id, companyId }, data: { recipeSnapshot: snapshot, recipeVersion: snapshot.version } });
    return snapshot;
  }

  private async resolveProductionRequirements(tx: Tx, companyId: string, recipeSnapshot: any, plannedQuantity: number) {
    const outputQuantity = parseQuantity(recipeSnapshot?.outputQuantity, "Retsept chiqish miqdori");
    if (outputQuantity <= 0) throw new BadRequestException({ code: "INVALID_OUTPUT_QUANTITY", message: "Retsept chiqish miqdori 0 dan katta bo'lishi kerak." });
    const targetQuantity = parseQuantity(plannedQuantity, "Reja miqdori");
    if (targetQuantity <= 0) throw new BadRequestException({ code: "INVALID_PLANNED_QUANTITY", message: "Reja miqdori 0 dan katta bo'lishi kerak." });
    const factor = targetQuantity / outputQuantity;
    const materials = Array.isArray(recipeSnapshot?.materials) ? recipeSnapshot.materials : [];
    const products = await tx.product.findMany({
      where: { companyId, id: { in: materials.map((material: any) => material.productId).filter(Boolean) }, deletedAt: null },
      select: { id: true, name: true, sku: true, unit: true, cost: true },
    });
    const productMap = new Map(products.map((product) => [product.id, product]));
    return materials.map((material: any, index: number) => {
      const product = material.productId ? productMap.get(material.productId) : null;
      if (!product) {
        throw new NotFoundException({
          code: "PRODUCTION_MATERIAL_NOT_FOUND",
          message: `Retseptdagi "${material.productName || material.productId || `xomashyo ${index + 1}`}" mahsuloti topilmadi. Retseptni yangilang.`,
        });
      }
      const recipeUnit = normalizeUnit(material.unit || material.recipeUnit || product.unit);
      const canonicalPerRecipe = material.canonicalQuantity === undefined
        ? convertQuantity(material.quantity, recipeUnit, product.unit)
        : toNumber(material.canonicalQuantity);
      const requiredQuantity = roundQuantity(canonicalPerRecipe * factor);
      const unitCost = toNumber(product.cost ?? material.currentUnitCost ?? material.cost);
      return {
        id: material.recipeMaterialId || material.id || material.productId,
        recipeMaterialId: material.recipeMaterialId || material.id || null,
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        recipeQuantity: toNumber(material.quantity),
        recipeUnit,
        bomQuantity: toNumber(material.quantity),
        requiredQuantity,
        plannedQuantity: requiredQuantity,
        unit: product.unit,
        cost: unitCost,
        totalCost: roundMoney(requiredQuantity * unitCost, 6),
        productionFactor: factor,
      };
    });
  }

  private async normalizeSnapshotRequirements(tx: Tx, companyId: string, materials: any[], recipeSnapshot: any, plannedQuantity: number) {
    if (!materials.length) return this.resolveProductionRequirements(tx, companyId, recipeSnapshot, plannedQuantity);
    const productIds = materials.map((material) => material.productId).filter(Boolean);
    const products = await tx.product.findMany({ where: { companyId, id: { in: productIds }, deletedAt: null }, select: { id: true, name: true, sku: true, unit: true, cost: true } });
    const productMap = new Map(products.map((product) => [product.id, product]));
    return materials.map((material, index) => {
      const product = productMap.get(material.productId);
      if (!product) {
        throw new NotFoundException({
          code: "PRODUCTION_MATERIAL_NOT_FOUND",
          message: `Retseptdagi "${material.productName || material.productId || `xomashyo ${index + 1}`}" mahsuloti topilmadi. Retseptni yangilang.`,
        });
      }
      const requiredQuantity = this.convertToProductUnit(material.requiredQuantity ?? material.plannedQuantity ?? material.quantity, material.unit || product.unit, product.unit, "Reja xomashyo miqdori");
      return {
        ...material,
        id: material.id || material.recipeMaterialId || product.id,
        productId: product.id,
        productName: material.productName || product.name,
        sku: material.sku || product.sku,
        requiredQuantity,
        plannedQuantity: requiredQuantity,
        unit: product.unit,
        cost: toNumber(material.cost ?? product.cost),
        reservedQuantity: toNumber(material.reservedQuantity),
      };
    });
  }

  private async getMaterialAvailabilityInTx(tx: Tx, companyId: string, warehouseId: string, requiredMaterials: any[]) {
    const productIds = [...new Set(requiredMaterials.map((material) => material.productId).filter(Boolean))] as string[];
    const stockItems = productIds.length
      ? await tx.stockItem.findMany({ where: { companyId, warehouseId, productId: { in: productIds } }, include: { product: true } })
      : [];
    const stockMap = new Map(stockItems.map((item) => [item.productId, item]));
    return requiredMaterials.map((material) => {
      const stock = stockMap.get(material.productId);
      const quantity = decimalToNumber(stock?.quantity);
      const reserved = decimalToNumber(stock?.reserved);
      const available = roundQuantity(Math.max(quantity - reserved, 0));
      const required = roundQuantity(material.requiredQuantity ?? material.plannedQuantity ?? 0);
      const shortage = roundQuantity(Math.max(required - available, 0));
      return {
        ...material,
        requiredQuantity: required,
        plannedQuantity: required,
        quantity,
        warehouseQuantity: quantity,
        reserved,
        reservedQuantity: toNumber(material.reservedQuantity),
        available,
        availableQuantity: available,
        shortage,
        missingQuantity: shortage,
        enough: shortage <= 0,
        totalCost: roundMoney(required * toNumber(material.cost), 6),
      };
    });
  }

  private async reserveStockInTx(tx: Tx, companyId: string, input: any, actorUserId?: string) {
    const product = await this.requireProduct(tx, companyId, input.productId);
    await this.requireWarehouse(tx, companyId, input.warehouseId);
    const quantity = this.convertToProductUnit(input.quantity, input.unit || input.inputUnit || product.unit, product.unit, "Rezerv miqdori");
    if (quantity <= 0) throw new BadRequestException({ code: "INVALID_QUANTITY", message: "Rezerv miqdori 0 dan katta bo'lsin." });
    const item = await this.ensureStockItem(tx, companyId, input.warehouseId, input.productId);
    const available = roundQuantity(toNumber(item.quantity) - toNumber(item.reserved));
    if (quantity > available) {
      throw new ConflictException({ code: "INSUFFICIENT_AVAILABLE_STOCK", message: `${product.name} yetarli emas. Kerak: ${quantity} ${product.unit}. Mavjud: ${Math.max(available, 0)} ${product.unit}.` });
    }
    const updated = await tx.stockItem.updateMany({
      where: { id: item.id, quantity: { gte: roundQuantity(toNumber(item.reserved) + quantity) } },
      data: { reserved: { increment: quantity } },
    });
    if (updated.count !== 1) throw new ConflictException({ code: "STOCK_RESERVATION_CONFLICT", message: "Qoldiq parallel operatsiya sabab o'zgardi. Qayta urinib ko'ring." });
    await this.writeAudit(tx, companyId, actorUserId, "stock.reserve", "product", input.productId, { warehouseId: input.warehouseId, quantity, unit: product.unit, sourceType: input.sourceType || null, sourceId: input.sourceId || null });
    return quantity;
  }

  private async releaseReservationInTx(tx: Tx, companyId: string, input: any, actorUserId?: string) {
    const product = await this.requireProduct(tx, companyId, input.productId);
    const quantity = this.convertToProductUnit(input.quantity, input.unit || input.inputUnit || product.unit, product.unit, "Rezervdan chiqarish miqdori");
    if (quantity <= 0) return 0;
    const item = await this.ensureStockItem(tx, companyId, input.warehouseId, input.productId);
    const updated = await tx.stockItem.updateMany({
      where: { id: item.id, reserved: { gte: quantity } },
      data: { reserved: { decrement: quantity } },
    });
    if (updated.count !== 1) throw new ConflictException({ code: "RESERVATION_RELEASE_CONFLICT", message: "Rezerv qoldig'i yetarli emas." });
    await this.writeAudit(tx, companyId, actorUserId, "stock.release_reservation", "product", input.productId, { warehouseId: input.warehouseId, quantity, unit: product.unit, sourceType: input.sourceType || null, sourceId: input.sourceId || null });
    return quantity;
  }

  private async consumeReservedStockInTx(tx: Tx, companyId: string, input: any, actorUserId?: string) {
    const product = await this.requireProduct(tx, companyId, input.productId);
    const quantity = this.convertToProductUnit(input.quantity, input.unit || input.inputUnit || product.unit, product.unit, "Rezerv sarfi");
    if (quantity <= 0) return [];
    const item = await this.ensureStockItem(tx, companyId, input.warehouseId, input.productId);
    const reserved = toNumber(item.reserved);
    if (quantity > reserved) throw new ConflictException({ code: "RESERVED_STOCK_INSUFFICIENT", message: `${product.name} rezervi yetarli emas. Rezerv: ${reserved} ${product.unit}.` });
    const updated = await tx.stockItem.updateMany({
      where: { id: item.id, reserved: { gte: quantity } },
      data: { reserved: { decrement: quantity } },
    });
    if (updated.count !== 1) throw new ConflictException({ code: "RESERVED_STOCK_INSUFFICIENT", message: `${product.name} rezervi yetarli emas.` });
    const allocations = await this.adjustStockDelta(tx, companyId, input.warehouseId, input.productId, -quantity, {
      type: input.type || "CONSUME",
      reason: input.reason || "RESERVED_CONSUMPTION",
      sourceType: input.sourceType || "PRODUCTION",
      sourceId: input.sourceId || "",
      idempotencyKey: input.idempotencyKey,
      note: input.note,
      actorUserId,
    });
    await this.writeAudit(tx, companyId, actorUserId, "stock.consume_reserved", "product", input.productId, { warehouseId: input.warehouseId, quantity, unit: product.unit, sourceType: input.sourceType || null, sourceId: input.sourceId || null });
    return allocations;
  }

  private sumAllocationCost(allocations: any[] = []) {
    return roundMoney(allocations.reduce((sum, allocation) => sum + toNumber(allocation.quantity) * toNumber(allocation.unitCost), 0), 6);
  }

  private getSnapshotNormalWastePercent(order: any) {
    if (order.recipeSnapshot && typeof order.recipeSnapshot === "object" && order.recipeSnapshot.normalWastePercent !== undefined && order.recipeSnapshot.normalWastePercent !== null) {
      return toNumber(order.recipeSnapshot.normalWastePercent);
    }
    if (order.bom?.normalWastePercent !== null && order.bom?.normalWastePercent !== undefined) return decimalToNumber(order.bom.normalWastePercent);
    return null;
  }

  async updateProductionStage(companyId: string, orderId: string, stageId: string, action: "start" | "complete", body: any = {}) {
    const tenantId = this.requireCompany(companyId);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findFirst({
        where: { id: orderId, companyId: tenantId },
        include: {
          bom: { include: { materials: true, outputProduct: true } },
          stages: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
        },
      });
      if (!order) throw new NotFoundException({ code: "PRODUCTION_NOT_FOUND", message: "Ishlab chiqarish topilmadi." });

      const stageIndex = order.stages.findIndex((item) => item.id === stageId);
      const stage = stageIndex >= 0 ? order.stages[stageIndex] : null;
      if (!stage) throw new NotFoundException({ code: "PRODUCTION_STAGE_NOT_FOUND", message: "Bosqich topilmadi." });

      if (order.status === "COMPLETED" || order.status === "CANCELLED") {
        throw new ConflictException({ code: "PRODUCTION_LOCKED", message: "Yakunlangan ishlab chiqarish bosqichi o'zgartirilmaydi." });
      }
      if (order.status !== "IN_PROGRESS") {
        throw new ConflictException({ code: "PRODUCTION_NOT_STARTED", message: "Avval ishlab chiqarishni boshlang." });
      }

      if (action === "start") {
        if (stage.status === "IN_PROGRESS") throw new ConflictException({ code: "STAGE_ALREADY_STARTED", message: "Bosqich allaqachon boshlangan." });
        if (stage.status === "COMPLETED") throw new ConflictException({ code: "STAGE_ALREADY_COMPLETED", message: "Tugagan bosqichni qayta boshlash mumkin emas." });
        if (stage.status !== "PLANNED") throw new ConflictException({ code: "STAGE_TRANSITION_INVALID", message: "Bosqichni boshlash mumkin emas." });

        const previousStage = stageIndex > 0 ? order.stages[stageIndex - 1] : null;
        if (previousStage && previousStage.status !== "COMPLETED") {
          throw new ConflictException({ code: "PREVIOUS_STAGE_INCOMPLETE", message: `"${previousStage.name}" bosqichi tugatilmagan.` });
        }

        const updated = await tx.productionStage.updateMany({
          where: { id: stageId, orderId, status: "PLANNED" },
          data: { status: "IN_PROGRESS", startedAt: new Date() },
        });
        if (updated.count !== 1) throw new ConflictException({ code: "STAGE_STATE_CHANGED", message: "Bosqich holati o'zgargan. Sahifani yangilang." });
      } else {
        if (stage.status === "COMPLETED") throw new ConflictException({ code: "STAGE_ALREADY_COMPLETED", message: "Bosqich allaqachon tugatilgan." });
        if (stage.status !== "IN_PROGRESS") throw new ConflictException({ code: "STAGE_NOT_IN_PROGRESS", message: "Avval bosqichni boshlang." });

        const updated = await tx.productionStage.updateMany({
          where: { id: stageId, orderId, status: "IN_PROGRESS" },
          data: { status: "COMPLETED", endedAt: new Date(), notes: body.notes || body.note || stage.notes },
        });
        if (updated.count !== 1) throw new ConflictException({ code: "STAGE_STATE_CHANGED", message: "Bosqich holati o'zgargan. Sahifani yangilang." });
      }

      const updatedOrder = await tx.productionOrder.findFirst({
        where: { id: orderId, companyId: tenantId },
        include: {
          bom: { include: { materials: true, outputProduct: true } },
          stages: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
        },
      });
      if (!updatedOrder) throw new NotFoundException({ code: "PRODUCTION_NOT_FOUND", message: "Ishlab chiqarish topilmadi." });

      return this.productionOrderDto(updatedOrder);
    });
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

    const requestedCurrency = settings?.formats?.currency || settings?.defaults?.currency || settings?.currency;
    if (requestedCurrency) {
      await this.prisma.company.update({
        where: { id: tenantId },
        data: { currency: normalizeCurrency(requestedCurrency) },
      });
    }

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

  private async changeStock(companyId: string, body: any, actorUserId?: string) {
    const tenantId = this.requireCompany(companyId);
    const rawAmount = parseQuantity(body.quantity, "Miqdor");
    if (!rawAmount || rawAmount <= 0) throw new BadRequestException({ code: "INVALID_QUANTITY", message: "Miqdor 0 dan katta bo'lsin." });

    return this.prisma.$transaction(async (tx) => {
      const product = await this.requireProduct(tx, tenantId, body.productId);
      const canonicalAmount = this.convertToProductUnit(rawAmount, body.inputUnit || body.unit || product.unit, product.unit, "Miqdor");
      const amount = body.type === "OUT" ? -canonicalAmount : canonicalAmount;
      await this.adjustStockDelta(tx, tenantId, body.warehouseId, body.productId, amount, {
        type: amount > 0 ? "IN" : "OUT",
        reason: body.reason,
        sourceType: body.sourceType || "MANUAL",
        sourceId: body.sourceId || `${Date.now()}`,
        idempotencyKey: body.idempotencyKey,
        note: body.note,
        cost: body.cost,
        totalCost: body.totalCost,
        inputUnit: body.inputUnit || body.unit || product.unit,
        batchNumber: body.batchNumber,
        expiryDate: body.expiryDate,
        productionDate: body.productionDate,
        receivedDate: body.receivedDate,
        actorUserId,
      });

      await this.writeAudit(tx, tenantId, actorUserId, amount > 0 ? "stock.in" : "stock.out", "product", body.productId, { warehouseId: body.warehouseId, quantity: Math.abs(amount), unit: product.unit, reason: body.reason || null, note: body.note || null });
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
    const product = await this.requireProduct(tx, companyId, productId);
    const item = await this.ensureStockItem(tx, companyId, warehouseId, productId);
    const current = toNumber(item.quantity);
    const reserved = toNumber(item.reserved);
    const absoluteDelta = roundQuantity(Math.abs(delta));
    if (delta < 0 && Math.abs(delta) > Math.max(current - reserved, 0)) {
      const required = absoluteDelta;
      const available = roundQuantity(Math.max(current - reserved, 0));
      const message = movement.sourceType === "PRODUCTION"
        ? `${product.name} yetarli emas. Kerak: ${required} ${product.unit}. Mavjud: ${available} ${product.unit}.`
        : movement.sourceType === "PRODUCTION_PACKAGING"
          ? `${product.name} qadoqlash materiali yetarli emas. Kerak: ${required} ${product.unit}. Mavjud: ${available} ${product.unit}.`
          : `Mavjud qoldiq yetarli emas. Mavjud: ${available} ${product.unit}.`;
      throw new ConflictException({ code: "INSUFFICIENT_AVAILABLE_STOCK", message });
    }
    const next = roundQuantity(current + delta);
    if (next < 0) throw new ConflictException({ code: "NEGATIVE_STOCK", message: `Yetarli qoldiq yo'q. Mavjud: ${current}.` });
    if (delta < 0 && product.status !== "ACTIVE") {
      throw new ConflictException({ code: "PRODUCT_INACTIVE", message: "Faol bo'lmagan mahsulot sotilmaydi." });
    }
    const canonicalUnitCost = this.resolveCanonicalUnitCost(product, movement, absoluteDelta);

    const allocations: any[] = [];
    if (delta > 0) {
      const batchNumber = movement.batchNumber || `${movement.sourceType || "MANUAL"}-${movement.sourceId || Date.now()}-${randomUUID().slice(0, 8)}`;
      const existingBatch = movement.batchNumber
        ? await tx.batch.findFirst({ where: { companyId, batchNumber, productId, warehouseId } })
        : null;
      const batch = existingBatch
        ? await tx.batch.update({
          where: { id: existingBatch.id },
          data: {
            status: "ACTIVE",
            quantity: { increment: delta },
            remainingQuantity: { increment: delta },
            productionDate: movement.productionDate ? parseOptionalDate(movement.productionDate) : existingBatch.productionDate,
            receivedDate: movement.receivedDate ? parseOptionalDate(movement.receivedDate) : existingBatch.receivedDate,
            expiryDate: movement.expiryDate ? parseOptionalDate(movement.expiryDate) : existingBatch.expiryDate,
            unitCost: canonicalUnitCost,
          },
        })
        : await tx.batch.create({
          data: {
            companyId,
            batchNumber,
            productId,
            warehouseId,
            quantity: delta,
            remainingQuantity: delta,
            productionDate: movement.productionDate ? parseOptionalDate(movement.productionDate) : movement.sourceType === "PRODUCTION" ? new Date() : null,
            receivedDate: movement.receivedDate ? parseOptionalDate(movement.receivedDate) : new Date(),
            expiryDate: movement.expiryDate ? parseOptionalDate(movement.expiryDate) : product.expiryDate,
            unitCost: canonicalUnitCost,
            sourceType: movement.sourceType || "MANUAL",
            sourceId: movement.sourceId || null,
          },
        });
      allocations.push({ batchId: batch.id, quantity: delta, unitCost: toNumber(batch.unitCost) });
      await tx.stockMovement.create({ data: this.stockMovementData(companyId, warehouseId, product, movement, delta, batch.id) });
      await tx.stockItem.update({ where: { id: item.id }, data: { quantity: { increment: delta }, cost: canonicalUnitCost } });
    } else {
      const guarded = await tx.stockItem.updateMany({
        where: {
          id: item.id,
          companyId,
          warehouseId,
          productId,
          quantity: { gte: roundQuantity(reserved + absoluteDelta) },
        },
        data: { quantity: { decrement: absoluteDelta } },
      });
      if (guarded.count !== 1) {
        const fresh = await tx.stockItem.findUnique({ where: { id: item.id } });
        const available = roundQuantity(Math.max(toNumber(fresh?.quantity) - toNumber(fresh?.reserved), 0));
        throw new ConflictException({ code: "INSUFFICIENT_AVAILABLE_STOCK", message: `Mavjud qoldiq yetarli emas. Mavjud: ${available} ${product.unit}.` });
      }
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
        const batchUpdate = await tx.batch.updateMany({
          where: { id: batch.id, companyId, remainingQuantity: { gte: take } },
          data: { remainingQuantity: { decrement: take } },
        });
        if (batchUpdate.count !== 1) {
          throw new ConflictException({ code: "BATCH_STATE_CONFLICT", message: "Batch qoldig'i parallel operatsiya sabab o'zgardi. Qayta urinib ko'ring." });
        }
        const key = movement.idempotencyKey ? `${movement.idempotencyKey}:batch:${index}` : undefined;
        await tx.batchConsumption.create({ data: { companyId, batchId: batch.id, productId, warehouseId, quantity: take, unitCost: batch.unitCost, sourceType: movement.sourceType || "STOCK_OUT", sourceId: movement.sourceId || "", idempotencyKey: key } });
        await tx.stockMovement.create({ data: this.stockMovementData(companyId, warehouseId, product, movement, take, batch.id, index === 0 ? movement.idempotencyKey : key) });
        allocations.push({ batchId: batch.id, quantity: take, unitCost: toNumber(batch.unitCost) });
        remaining = roundQuantity(remaining - take);
      }
      if (remaining > 0) throw new ConflictException({ code: "BATCH_STOCK_MISMATCH", message: "Batch qoldig'i ombor qoldig'i bilan mos emas." });
    }
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
      cost: this.resolveCanonicalUnitCost(product, movement, Math.abs(quantity)),
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
      const existingLegacy = await tx.batch.findFirst({
        where: { companyId, warehouseId, productId, sourceType: "LEGACY_STOCK", sourceId: `${warehouseId}:${productId}` },
        orderBy: { createdAt: "asc" },
      });
      if (existingLegacy) {
        await tx.batch.update({
          where: { id: existingLegacy.id },
          data: {
            status: "ACTIVE",
            quantity: { increment: missing },
            remainingQuantity: { increment: missing },
          },
        });
      } else {
        await tx.batch.create({
          data: {
            companyId,
            batchNumber: `LEGACY-${warehouseId.slice(-6)}-${productId.slice(-6)}`,
            productId,
            warehouseId,
            quantity: missing,
            remainingQuantity: missing,
            receivedDate: new Date(),
            expiryDate: product.expiryDate,
            unitCost: product.cost,
            sourceType: "LEGACY_STOCK",
            sourceId: `${warehouseId}:${productId}`,
          },
        });
      }
    }
  }

  private async getInventoryPolicy(client: Tx | PrismaService, companyId: string) {
    const company = await client.company.findUnique({ where: { id: companyId }, select: { inventoryPolicy: true } });
    return company?.inventoryPolicy === "FIFO" ? "FIFO" : "FEFO";
  }

  private async requireProduct(client: Tx | PrismaService, companyId: string, productId: string) {
    const product = await client.product.findFirst({ where: { id: productId, companyId, deletedAt: null } });
    if (!product) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: "Mahsulot topilmadi." });
    return product;
  }

  private convertToProductUnit(value: unknown, inputUnit: unknown, productUnit: unknown, field = "Miqdor") {
    const quantity = parseQuantity(value, field);
    const canonical = convertQuantity(quantity, inputUnit || productUnit, productUnit);
    return roundQuantity(canonical);
  }

  private resolveCanonicalUnitCost(product: any, movement: any, quantity: number) {
    if (movement.totalCost !== undefined && movement.totalCost !== null && movement.totalCost !== "") {
      return quantity > 0 ? roundMoney(toNumber(movement.totalCost) / quantity, 6) : 0;
    }

    if (movement.cost === undefined || movement.cost === null || movement.cost === "") {
      return toNumber(product.cost);
    }

    const inputUnit = movement.inputUnit ? normalizeUnit(movement.inputUnit) : normalizeUnit(product.unit);
    const productUnit = normalizeUnit(product.unit);
    const cost = toNumber(movement.cost);
    if (inputUnit === productUnit) return cost;

    const canonicalPerInputUnit = convertQuantity(1, inputUnit, productUnit);
    return canonicalPerInputUnit > 0 ? roundMoney(cost / canonicalPerInputUnit, 6) : cost;
  }

  async reserveStock(companyId: string, input: any, actorUserId?: string) {
    const tenantId = this.requireCompany(companyId);
    return this.prisma.$transaction(async (tx) => {
      await this.reserveStockInTx(tx, tenantId, input, actorUserId);
      const item = await this.ensureStockItem(tx, tenantId, input.warehouseId, input.productId);
      return this.stockDto(await tx.stockItem.findUnique({ where: { id: item.id }, include: { product: true, warehouse: true } }));
    });
  }

  async releaseReservation(companyId: string, input: any, actorUserId?: string) {
    const tenantId = this.requireCompany(companyId);
    return this.prisma.$transaction(async (tx) => {
      await this.releaseReservationInTx(tx, tenantId, input, actorUserId);
      const item = await this.ensureStockItem(tx, tenantId, input.warehouseId, input.productId);
      return this.stockDto(await tx.stockItem.findUnique({ where: { id: item.id }, include: { product: true, warehouse: true } }));
    });
  }

  async consumeReservedStock(companyId: string, input: any, actorUserId?: string) {
    const tenantId = this.requireCompany(companyId);
    return this.prisma.$transaction(async (tx) => {
      return this.consumeReservedStockInTx(tx, tenantId, input, actorUserId);
    });
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
    if (!productId) {
      throw new BadRequestException({
        code: "PRODUCT_ID_REQUIRED",
        field: type === "RAW_MATERIAL" ? "productId" : "outputProductId",
        message: "Retseptda mahsulotni ro'yxatdan tanlang. Yangi mahsulotni avval to'liq forma orqali yarating.",
      });
    }

    const existing = await tx.product.findFirst({ where: { id: productId, companyId, deletedAt: null } });
    if (!existing) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: "Mahsulot topilmadi." });

    const compatibleTypes = type === "RAW_MATERIAL"
      ? ["RAW_MATERIAL", "SEMI_FINISHED"]
      : ["FINISHED_GOOD", "SEMI_FINISHED"];
    if (existing.type && !compatibleTypes.includes(existing.type)) {
      throw new BadRequestException({
        code: "PRODUCT_TYPE_INVALID",
        field: type === "RAW_MATERIAL" ? "productId" : "outputProductId",
        message: type === "RAW_MATERIAL"
          ? "Retsept xomashyosi RAW_MATERIAL yoki SEMI_FINISHED bo'lishi kerak."
          : "Retsept natijasi FINISHED_GOOD yoki SEMI_FINISHED bo'lishi kerak.",
      });
    }

    // Product.unit is the source of truth. The recipe/purchase unit is kept on
    // BomMaterial/PurchaseItem and is normalized by their respective helpers.
    void productName;
    void unit;
    return existing;
  }

  private throwProductUniqueConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = Array.isArray(error.meta?.target)
        ? error.meta.target.map(String).join(" ")
        : String(error.meta?.target || "");
      const field = /barcode/i.test(target) ? "barcode" : /sku/i.test(target) ? "sku" : null;
      if (field === "sku") {
        throw new ConflictException({ code: "SKU_DUPLICATE", field, message: "Bu SKU boshqa mahsulotda mavjud." });
      }
      if (field === "barcode") {
        throw new ConflictException({ code: "BARCODE_DUPLICATE", field, message: "Bu shtrix-kod boshqa mahsulotda mavjud." });
      }
    }
    throw error;
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
    const existing = await this.resolveDefaultWarehouse(companyId, true);
    if (existing) return existing;
    return this.prisma.warehouse.create({ data: { companyId, name: "Asosiy ombor", code: "MAIN" } });
  }

  private async resolveDefaultWarehouse(companyId: string, includeAnyActive: boolean) {
    const setting = await this.prisma.companySetting.findUnique({
      where: { companyId_key: { companyId, key: "platform" } },
      select: { value: true },
    });
    const settings: any = setting?.value || {};
    const configuredIds = [
      settings?.defaults?.warehouseId,
      settings?.warehouse?.defaultWarehouseId,
      settings?.manufacturing?.defaultProductionWarehouseId,
      settings?.pos?.defaultWarehouseId,
    ].filter(Boolean);
    const configured = configuredIds.length
      ? await this.prisma.warehouse.findFirst({ where: { companyId, status: "ACTIVE", id: { in: configuredIds } } })
      : null;
    if (configured) return configured;

    const byCode = await this.prisma.warehouse.findFirst({ where: { companyId, status: "ACTIVE", code: "MAIN" }, orderBy: { createdAt: "asc" } });
    if (byCode) return byCode;
    const byName = await this.prisma.warehouse.findFirst({ where: { companyId, status: "ACTIVE", name: "Asosiy ombor" }, orderBy: { createdAt: "asc" } });
    if (byName) return byName;
    return includeAnyActive
      ? this.prisma.warehouse.findFirst({ where: { companyId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } })
      : null;
  }

  private async ensureDefaultCashbox(tx: Tx, companyId: string) {
    const existing = await tx.cashbox.findFirst({ where: { companyId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
    if (existing) return existing;
    const company = await tx.company.findUnique({ where: { id: companyId }, select: { currency: true } });
    return tx.cashbox.create({ data: { companyId, name: "Asosiy kassa", currency: normalizeCurrency(company?.currency || "UZS") } });
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
      const purchaseQuantity = parseQuantity(item.purchaseQuantity ?? item.quantity);
      const purchaseUnit = normalizeUnit(item.purchaseUnit || item.unit || product?.unit);
      const unit = product?.unit ? normalizeUnit(product.unit) : purchaseUnit;
      const quantity = roundQuantity(convertQuantity(purchaseQuantity, purchaseUnit, unit));
      const lineTotal = roundMoney(item.lineTotal ?? item.total ?? item.subtotal ?? item.purchasePrice ?? item.cost ?? item.price);
      const cost = quantity > 0 ? roundMoney(lineTotal / quantity, 6) : 0;
      if (quantity <= 0) throw new BadRequestException({ code: "INVALID_QUANTITY", message: "Miqdor 0 dan katta bo'lsin." });
      if (lineTotal < 0) throw new BadRequestException({ code: "INVALID_PURCHASE_PRICE", message: "Xarid narxi manfiy bo'lmasin." });
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
        subtotal: lineTotal,
      };
    });
  }

  private normalizeBomMaterial(product: any, item: any) {
    const productUnit = normalizeUnit(product?.unit || item?.unit);
    const recipeUnit = normalizeUnit(item?.unit || productUnit);
    const quantity = parseQuantity(item?.quantity, "Xomashyo miqdori");
    const cost = product
      ? roundMoney(toNumber(product.cost) * convertQuantity(1, recipeUnit, productUnit))
      : roundMoney(item?.cost);

    return { quantity, unit: recipeUnit, cost };
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
    return rows.map((row: any, index: number) => {
      const quantity = parseQuantity(row.quantity ?? row.count ?? 0, "Qadoq soni");
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new BadRequestException({ code: "PACKAGING_COUNT_INTEGER", message: "Qadoq soni butun son bo'lishi kerak." });
      }
      const inputPackUnit = normalizeUnit(row.packUnit || unit);
      const normalizedPackSize = convertQuantity(parseQuantity(row.packSize ?? row.size ?? 0, "Qadoq hajmi"), inputPackUnit, unit);
      if (normalizedPackSize <= 0) {
        throw new BadRequestException({ code: "PACKAGING_SIZE_INVALID", message: "Qadoq hajmi 0 dan katta bo'lishi kerak." });
      }
      return {
        id: row.id || `package-${index + 1}`,
        productId: row.productId || null,
        productName: String(row.productName || row.name || "").trim(),
        quantity,
        packSize: normalizedPackSize,
        packUnit: normalizeUnit(unit),
        materials: Array.isArray(row.materials || row.packagingMaterials) ? (row.materials || row.packagingMaterials).map((material: any) => ({
          productId: material.productId,
          quantity: parseQuantity(material.quantity, "Qadoq materiali"),
          unit: material.unit ? normalizeUnit(material.unit) : undefined,
        })).filter((material: any) => material.productId && material.quantity > 0) : [],
      };
    }).filter((row: any) => row.quantity > 0 && row.packSize > 0);
  }

  private async ensurePackagedVariant(tx: Tx, companyId: string, parentProductId: string, parentName: string, parentUnit: string, row: any) {
    if (row.productId) {
      const existing = await tx.product.findFirst({ where: { id: row.productId, companyId, deletedAt: null } });
      if (!existing) throw new NotFoundException({ code: "PACKAGED_PRODUCT_NOT_FOUND", message: "Qadoqlangan SKU topilmadi." });
      if (normalizeUnit(existing.unit) !== "dona") throw new BadRequestException({ code: "PACKAGED_PRODUCT_UNIT_INVALID", message: "Qadoqlangan mahsulot birligi dona bo'lishi kerak." });
      return existing;
    }
    const name = row.productName || `${parentName} ${row.packSize} ${parentUnit}`;
    const sku = `PKG-${parentProductId.slice(-8)}-${String(row.packSize).replace(".", "-")}`;
    return tx.product.upsert({
      where: { companyId_sku: { companyId, sku } },
      update: { status: "ACTIVE", unit: "dona", parentProductId, packSize: row.packSize, packUnit: row.packUnit || parentUnit, isVariant: true },
      create: { companyId, name, sku, type: "FINISHED_GOOD", unit: "dona", parentProductId, packSize: row.packSize, packUnit: row.packUnit || parentUnit, isVariant: true, stock: 0 },
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
    return {
      ...history,
      supplierName: history.supplier?.name || null,
      productName: history.product?.name || null,
      price: decimalToNumber(history.price),
      purchaseQuantity: history.purchaseQuantity === null || history.purchaseQuantity === undefined ? null : decimalToNumber(history.purchaseQuantity),
      canonicalUnitPrice: history.canonicalUnitPrice === null || history.canonicalUnitPrice === undefined ? null : decimalToNumber(history.canonicalUnitPrice),
    };
  }

  private stockDto(stock: any) {
    const stockBatches = stock.product?.batches?.filter((batch: any) => batch.warehouseId === stock.warehouseId && decimalToNumber(batch.remainingQuantity) > 0) || [];
    const nearestExpiry = stockBatches.filter((batch: any) => batch.expiryDate)?.sort((left: any, right: any) => new Date(left.expiryDate).getTime() - new Date(right.expiryDate).getTime())[0]?.expiryDate || null;
    const expiryDays = nearestExpiry ? Math.ceil((new Date(nearestExpiry).getTime() - Date.now()) / 86_400_000) : null;
    return {
      id: stock.id,
      companyId: stock.companyId,
      warehouseId: stock.warehouseId,
      warehouseName: stock.warehouse?.name,
      productId: stock.productId,
      productName: stock.product?.name,
      sku: stock.product?.sku,
      type: stock.product?.type,
      category: stock.product?.categoryRef?.name || stock.product?.category || null,
      image: stock.product?.image || "",
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
      batchNumber: movement.batch?.batchNumber || null,
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

  private safeNormalizeUnit(value: unknown, fallback = "dona") {
    try {
      return normalizeUnit(value || fallback);
    } catch {
      return normalizeUnit(fallback);
    }
  }

  private bomDto(bom: any) {
    return {
      ...bom,
      outputQuantity: decimalToNumber(bom.outputQuantity),
      quantity: decimalToNumber(bom.outputQuantity),
      overheadCost: decimalToNumber(bom.overheadCost),
      productId: bom.outputProductId,
      productName: bom.outputProduct?.name || bom.outputProductName,
      unit: bom.outputProduct?.unit || this.safeNormalizeUnit(bom.unit),
      version: bom.version || 1,
      versionGroupId: bom.versionGroupId || bom.id,
      active: bom.status === "ACTIVE",
      normalWastePercent: bom.normalWastePercent === null || bom.normalWastePercent === undefined ? null : decimalToNumber(bom.normalWastePercent),
      materials: bom.materials?.map((item: any) => ({
        ...item,
        quantity: decimalToNumber(item.quantity),
        unit: this.safeNormalizeUnit(item.unit),
        cost: decimalToNumber(item.cost),
      })) || [],
    };
  }

  private safeProductionOrderDto(order: any) {
    try {
      return this.productionOrderDto(order);
    } catch (error) {
      this.logger.error(
        `production_order_dto_failed orderId=${order?.id || "unknown"}`,
        error instanceof Error ? error.stack : String(error),
      );

      const actualQuantity = decimalToNumber(order?.actualQuantity);
      const stages = this.productionStageDtos(order?.stages);

      return {
        id: order?.id,
        companyId: order?.companyId,
        number: order?.number || order?.id || "production-order",
        bomId: order?.bomId || null,
        outputProductId: order?.outputProductId || null,
        outputProductName: order?.outputProductName || "",
        productId: order?.outputProductId || null,
        productName: order?.outputProductName || "",
        unit: this.safeNormalizeUnit(order?.unit),
        plannedQuantity: decimalToNumber(order?.plannedQuantity),
        producedQuantity: actualQuantity,
        actualQuantity,
        acceptedQuantity: decimalToNumber(order?.acceptedQuantity),
        defectQuantity: decimalToNumber(order?.defectQuantity),
        wasteQuantity: decimalToNumber(order?.wasteQuantity),
        yieldPercent: decimalToNumber(order?.yieldPercent),
        wastePercent: decimalToNumber(order?.wastePercent),
        recipeVersion: order?.recipeVersion || null,
        recipeSnapshot: order?.recipeSnapshot && typeof order.recipeSnapshot === "object" ? order.recipeSnapshot : null,
        packaging: Array.isArray(order?.packaging) ? order.packaging : [],
        remainingBulkQuantity: decimalToNumber(order?.remainingBulkQuantity),
        warehouseId: order?.warehouseId || null,
        materialWarehouseId: order?.materialWarehouseId || order?.warehouseId || null,
        outputWarehouseId: order?.outputWarehouseId || order?.warehouseId || null,
        status: order?.status || "PLANNED",
        materialCost: decimalToNumber(order?.materialCost),
        overheadCost: decimalToNumber(order?.overheadCost),
        productionCost: decimalToNumber(order?.productionCost),
        unitCost: decimalToNumber(order?.unitCost),
        actualMaterialCost: decimalToNumber(order?.actualMaterialCost),
        actualProductionCost: decimalToNumber(order?.actualProductionCost),
        actualUnitCost: decimalToNumber(order?.actualUnitCost),
        overheadItems: Array.isArray(order?.overheadItems) ? order.overheadItems : [],
        actualMaterials: Array.isArray(order?.actualMaterials) ? order.actualMaterials : [],
        qualityControl: order?.qualityControl || null,
        qualityStatus: order?.qualityStatus || order?.qualityControl?.status || null,
        qualityNote: order?.qualityNote || order?.qualityControl?.note || null,
        completionNote: order?.completionNote || null,
        plannedDate: order?.plannedDate || null,
        dueDate: order?.dueDate || null,
        priority: order?.priority || null,
        responsible: order?.responsible || null,
        startedAt: order?.startedAt || null,
        completedAt: order?.completedAt || null,
        cancelledAt: order?.cancelledAt || null,
        createdAt: order?.createdAt || null,
        updatedAt: order?.updatedAt || null,
        stages,
        requiredMaterials: [],
        bom: null,
      };
    }
  }

  private productionOrderDto(order: any) {
    const { actualQuantity, ...orderWithoutLegacyQuantity } = order;
    const snapshot = order.recipeSnapshot && typeof order.recipeSnapshot === "object" ? order.recipeSnapshot : null;
    const normalWastePercent = this.getSnapshotNormalWastePercent(order);
    const wastePercent = decimalToNumber(order.wastePercent);
    const plannedQuantity = decimalToNumber(order.plannedQuantity);
    const outputQuantity = toNumber(snapshot?.outputQuantity || order.bom?.outputQuantity);
    const productName = order.outputProductName || snapshot?.outputProductName || order.bom?.outputProductName || "";
    const productId = order.outputProductId || snapshot?.outputProductId || order.bom?.outputProductId || null;
    const materialSnapshot = Array.isArray(order.materialSnapshot) ? order.materialSnapshot as any[] : [];
    const snapshotMaterials = Array.isArray(snapshot?.materials) ? snapshot.materials : [];
    const requiredMaterials = materialSnapshot.length
      ? materialSnapshot.map((material: any, index: number) => {
        const planned = decimalToNumber(material.plannedQuantity ?? material.requiredQuantity);
        const actual = material.actualQuantity === undefined ? planned : decimalToNumber(material.actualQuantity);
        return {
          id: material.recipeMaterialId || material.id || material.productId || `material-${index + 1}`,
          productId: material.productId,
          productName: material.productName,
          sku: material.sku || "",
          recipeQuantity: decimalToNumber(material.recipeQuantity ?? material.bomQuantity),
          recipeUnit: material.recipeUnit || null,
          quantity: planned,
          bomQuantity: decimalToNumber(material.bomQuantity ?? material.recipeQuantity ?? planned),
          requiredQuantity: planned,
          plannedQuantity: planned,
          actualQuantity: actual,
          difference: decimalToNumber(material.difference ?? actual - planned),
          differencePercent: decimalToNumber(material.differencePercent ?? (planned > 0 ? ((actual - planned) / planned) * 100 : 0)),
          unit: this.safeNormalizeUnit(material.unit),
          cost: decimalToNumber(material.cost),
          actualCost: decimalToNumber(material.actualCost),
          totalCost: planned * decimalToNumber(material.cost),
          quantityOnHand: decimalToNumber(material.quantity),
          warehouseQuantity: decimalToNumber(material.warehouseQuantity ?? material.quantity),
          reserved: decimalToNumber(material.reserved),
          reservedQuantity: decimalToNumber(material.reservedQuantity),
          available: decimalToNumber(material.available),
          availableQuantity: decimalToNumber(material.availableQuantity ?? material.available),
          shortage: decimalToNumber(material.shortage),
          missingQuantity: decimalToNumber(material.missingQuantity ?? material.shortage),
          enough: Boolean(material.enough ?? decimalToNumber(material.shortage) <= 0),
          allocations: Array.isArray(material.allocations) ? material.allocations : [],
        };
      })
      : snapshotMaterials.map((material: any, index: number) => {
        const factor = outputQuantity > 0 ? plannedQuantity / outputQuantity : 0;
        const required = roundQuantity(toNumber(material.canonicalQuantity ?? material.quantity) * factor);
        const cost = toNumber(material.currentUnitCost ?? material.cost);
        return {
          id: material.recipeMaterialId || material.id || material.productId || `material-${index + 1}`,
          productId: material.productId,
          productName: material.productName,
          sku: material.sku || "",
          recipeQuantity: toNumber(material.quantity),
          recipeUnit: material.unit || material.recipeUnit || material.canonicalUnit,
          quantity: required,
          bomQuantity: toNumber(material.quantity),
          requiredQuantity: required,
          plannedQuantity: required,
          actualQuantity: required,
          unit: this.safeNormalizeUnit(material.canonicalUnit || material.unit),
          cost,
          totalCost: roundMoney(required * cost, 6),
        };
      });
    return {
      ...orderWithoutLegacyQuantity,
      plannedQuantity,
      producedQuantity: decimalToNumber(actualQuantity),
      actualQuantity: decimalToNumber(actualQuantity),
      acceptedQuantity: decimalToNumber(order.acceptedQuantity),
      defectQuantity: decimalToNumber(order.defectQuantity),
      wasteQuantity: decimalToNumber(order.wasteQuantity),
      yieldPercent: decimalToNumber(order.yieldPercent),
      wastePercent,
      normalWastePercent,
      abnormalWaste: normalWastePercent !== null && wastePercent > normalWastePercent,
      abnormalWastePercent: normalWastePercent === null ? 0 : roundMoney(Math.max(wastePercent - normalWastePercent, 0), 4),
      recipeVersion: order.recipeVersion || snapshot?.version || order.bom?.version || null,
      bomVersion: order.recipeVersion || snapshot?.version || order.bom?.version || null,
      recipeName: snapshot?.name || order.bom?.name || null,
      recipeSnapshot: snapshot,
      packaging: Array.isArray(order.packaging) ? order.packaging : [],
      remainingBulkQuantity: decimalToNumber(order.remainingBulkQuantity),
      materialWarehouseId: order.materialWarehouseId || order.warehouseId || null,
      outputWarehouseId: order.outputWarehouseId || order.warehouseId || null,
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
      plannedDate: order.plannedDate || null,
      dueDate: order.dueDate || null,
      priority: order.priority || null,
      responsible: order.responsible || null,
      stages: this.productionStageDtos(order.stages),
      productId,
      productName,
      outputProductId: productId,
      outputProductName: productName,
      requiredMaterials,
      bom: order.bom ? this.bomDto(order.bom) : null,
    };
  }

  private productionStageDtos(stages: any[] = []) {
    return [...(Array.isArray(stages) ? stages : [])]
      .sort((left: any, right: any) => {
        const leftOrder = Number.isFinite(Number(left?.sortOrder)) ? Number(left.sortOrder) : 0;
        const rightOrder = Number.isFinite(Number(right?.sortOrder)) ? Number(right.sortOrder) : 0;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return String(left?.id || "").localeCompare(String(right?.id || ""));
      })
      .map((stage: any) => ({
        ...stage,
        status: stage.status === "PLANNED" ? "PENDING" : stage.status,
        completedAt: stage.completedAt || stage.endedAt || null,
      }));
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
