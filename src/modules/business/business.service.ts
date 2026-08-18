import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, SaleStatus } from "@prisma/client";

import { ROLE_PERMISSION_MAP } from "../../common/constants/permissions.constants";
import { parseOptionalDate } from "../../common/utils/date.util";
import { decimalToNumber, roundMoney, toNumber } from "../../common/utils/money.util";
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
        include: { supplier: true },
      }),
    ]);

    return { products: products.map(this.productDto), data: products.map(this.productDto), meta: getPaginationMeta(page, limit, total) };
  }

  async getProduct(companyId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, companyId: this.requireCompany(companyId), deletedAt: null },
      include: {
        supplier: true,
        stockItems: { include: { warehouse: true } },
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
    const stock = toNumber(body.stock);
    if (stock < 0) throw new BadRequestException({ code: "NEGATIVE_STOCK", message: "Qoldiq manfiy bo'lmasin." });
    const warehouse = body.warehouseId
      ? await this.prisma.warehouse.findFirst({ where: { id: body.warehouseId, companyId: tenantId, status: "ACTIVE" } })
      : await this.ensureDefaultWarehouse(tenantId);
    if (!warehouse) throw new NotFoundException({ code: "WAREHOUSE_NOT_FOUND", message: "Ombor topilmadi." });
    if (body.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({ where: { id: body.supplierId, companyId: tenantId, deletedAt: null } });
      if (!supplier) throw new NotFoundException({ code: "SUPPLIER_NOT_FOUND", message: "Yetkazib beruvchi topilmadi." });
    }

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          companyId: tenantId,
          name: String(body.name || "Nomsiz mahsulot").trim(),
          sku,
          barcode: body.barcode || null,
          type: body.type || null,
          category: body.category || null,
          brand: body.brand || null,
          unit: body.unit || "dona",
          stock,
          minimumStock: toNumber(body.minimumStock),
          cost: roundMoney(body.cost),
          salePrice: body.salePrice === null || body.salePrice === "" || body.salePrice === undefined ? null : roundMoney(body.salePrice),
          tax: roundMoney(body.tax),
          discount: roundMoney(body.discount),
          image: body.image || null,
          notes: body.notes || null,
          supplierId: body.supplierId || null,
          status: body.status || "ACTIVE",
        },
      });

      if (stock > 0) {
        await tx.stockItem.create({
          data: {
            companyId: tenantId,
            warehouseId: warehouse.id,
            productId: product.id,
            quantity: stock,
            cost: product.cost,
            minimumStock: product.minimumStock,
          },
        });
        await tx.stockMovement.create({
          data: {
            companyId: tenantId,
            warehouseId: warehouse.id,
            productId: product.id,
            productName: product.name,
            type: "IN",
            quantity: stock,
            unit: product.unit,
            cost: product.cost,
            reason: "OPENING_STOCK",
            sourceType: "PRODUCT",
            sourceId: product.id,
          },
        });
      }

      return this.productDto(product);
    });
  }

  async updateProduct(companyId: string, id: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    await this.getProduct(companyId, id);
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
        category: body.category,
        brand: body.brand,
        unit: body.unit,
        minimumStock: body.minimumStock === undefined ? undefined : toNumber(body.minimumStock),
        cost: body.cost === undefined ? undefined : roundMoney(body.cost),
        salePrice: body.salePrice === undefined ? undefined : body.salePrice === null || body.salePrice === "" ? null : roundMoney(body.salePrice),
        tax: body.tax === undefined ? undefined : roundMoney(body.tax),
        discount: body.discount === undefined ? undefined : roundMoney(body.discount),
        image: body.image,
        notes: body.notes,
        supplierId: body.supplierId,
        status: body.status,
      },
    });

    return this.productDto(updated);
  }

  async changeProductStatus(companyId: string, id: string, status: "ACTIVE" | "INACTIVE" | "ARCHIVED") {
    await this.getProduct(companyId, id);
    const updated = await this.prisma.product.update({ where: { id, companyId: this.requireCompany(companyId) }, data: { status } });

    return this.productDto(updated);
  }

  async deleteProduct(companyId: string, id: string) {
    await this.getProduct(companyId, id);
    const historical = await this.prisma.saleItem.count({ where: { productId: id } });

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

  async adjustProductStock(companyId: string, id: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const product = await this.getProduct(tenantId, id);
    const warehouseId = body.warehouseId || (await this.ensureDefaultWarehouse(tenantId)).id;
    const newStock = toNumber(body.newStock ?? body.quantity);

    if (newStock < 0) throw new BadRequestException({ code: "NEGATIVE_STOCK", message: "Qoldiq manfiy bo'lmasin." });

    return this.prisma.$transaction(async (tx) => {
      await this.requireWarehouse(tx, tenantId, warehouseId);
      const item = await this.ensureStockItem(tx, tenantId, warehouseId, id);
      const oldQuantity = toNumber(item.quantity);
      const difference = roundMoney(newStock - oldQuantity, 3);

      await tx.stockItem.update({
        where: { id: item.id },
        data: { quantity: newStock },
      });
      await tx.stockMovement.create({
        data: {
          companyId: tenantId,
          warehouseId,
          productId: id,
          productName: product.name,
          type: "INVENTORY_ADJUSTMENT",
          quantity: Math.abs(difference),
          unit: product.unit,
          reason: body.reason || "MANUAL_ADJUSTMENT",
          note: body.note,
          sourceType: "PRODUCT",
          sourceId: id,
        },
      });
      await this.refreshProductStock(tx, tenantId, id);

      return this.getProduct(tenantId, id);
    });
  }

  async updateProductPrices(companyId: string, id: string, body: any) {
    return this.updateProduct(companyId, id, { cost: body.cost, salePrice: body.salePrice });
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

  async listStock(companyId: string, query: Record<string, string | undefined>) {
    const tenantId = this.requireCompany(companyId);
    const stock = await this.prisma.stockItem.findMany({
      where: {
        companyId: tenantId,
        warehouseId: query.warehouseId || undefined,
        productId: query.productId || undefined,
      },
      include: { product: true, warehouse: true },
      orderBy: { updatedAt: "desc" },
    });

    return { stock: stock.map(this.stockDto), data: stock.map(this.stockDto) };
  }

  async stockIn(companyId: string, body: any) {
    return this.changeStock(companyId, {
      ...body,
      type: "IN",
      quantity: toNumber(body.quantity),
      reason: body.source || body.reason || "MANUAL_IN",
    });
  }

  async stockOut(companyId: string, body: any) {
    return this.changeStock(companyId, {
      ...body,
      type: "OUT",
      quantity: -toNumber(body.quantity),
      reason: body.reason || "MANUAL_OUT",
    });
  }

  async transferStock(companyId: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const amount = toNumber(body.quantity);
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

    if (!supplier) throw new NotFoundException({ code: "SUPPLIER_NOT_FOUND", message: "Supplier topilmadi." });

    return {
      ...this.supplierDto(supplier),
      purchases: supplier.purchases.map(this.purchaseDto),
      products: supplier.products.map(this.productDto),
    };
  }

  async createSupplier(companyId: string, body: any) {
    const supplier = await this.prisma.supplier.create({
      data: {
        companyId: this.requireCompany(companyId),
        name: body.name || body.companyName || "Nomsiz supplier",
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
    const purchases = await this.prisma.purchase.count({ where: { supplierId: id } });

    if (purchases > 0) {
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
    const items = this.normalizePurchaseItems(body.items || []);
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
    await this.validateProductIds(this.prisma, tenantId, items.map((item) => item.productId));

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
              unit: item.unit,
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

    const items = body.items ? this.normalizePurchaseItems(body.items) : null;
    const total = items ? roundMoney(items.reduce((sum, item) => sum + item.subtotal, 0)) : undefined;
    if (items) await this.validateProductIds(this.prisma, tenantId, items.map((item) => item.productId));
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

  async receivePurchase(companyId: string, id: string, body: any) {
    const tenantId = this.requireCompany(companyId);

    return this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findFirst({ where: { id, companyId: tenantId }, include: { items: true } });
      if (!purchase) throw new NotFoundException({ code: "PURCHASE_NOT_FOUND", message: "Xarid topilmadi." });
      if (purchase.status === "RECEIVED" || purchase.status === "CANCELLED") {
        throw new ConflictException({ code: "PURCHASE_RECEIVE_BLOCKED", message: "Bu xaridni qabul qilib bo'lmaydi." });
      }

      const receivedItems = Array.isArray(body.receivedItems) ? body.receivedItems : purchase.items.map((item) => ({ productId: item.productId, purchaseItemId: item.id, quantity: toNumber(item.quantity) - toNumber(item.receivedQuantity) }));
      const warehouseId = body.warehouseId || purchase.warehouseId || (await this.ensureDefaultWarehouse(tenantId)).id;
      await this.requireWarehouse(tx, tenantId, warehouseId);

      for (const received of receivedItems) {
        const item = purchase.items.find((entry) => entry.id === received.purchaseItemId || entry.productId === received.productId);
        if (!item) continue;
        const amount = toNumber(received.quantity);
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

      return this.purchaseDto(updated);
    });
  }

  async payPurchase(companyId: string, id: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const amount = roundMoney(body.amount);
    const idempotencyKey = body.idempotencyKey || `purchase-payment:${id}:${Date.now()}`;
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
    const normalized = this.normalizeSalePayload(body);
    await this.validateProductIds(this.prisma, tenantId, normalized.items.map((item) => item.productId));
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

  async completeSale(companyId: string, body: any, idempotencyKey?: string) {
    const tenantId = this.requireCompany(companyId);
    const normalized = this.normalizeSalePayload(body);
    const key = idempotencyKey || body.idempotencyKey || normalized.id || null;

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

      for (const item of normalized.items) {
        await this.adjustStockDelta(tx, tenantId, normalized.warehouseId, item.productId, -item.quantity, {
          type: "OUT",
          reason: "SALE",
          sourceType: "SALE",
          sourceId: key || normalized.number || "sale",
        });
      }

      const number = normalized.number || (await this.generateNumber(tx, tenantId, "sale"));
      const saleData = {
        ...this.saleCreateData(tenantId, normalized, "COMPLETED"),
        number,
        idempotencyKey: key,
        completedAt: new Date(),
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

      return this.saleDto(sale);
    });
  }

  async cancelSale(companyId: string, id: string, body: any) {
    const tenantId = this.requireCompany(companyId);

    return this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({ where: { id, companyId: tenantId }, include: { items: true, returns: true, payments: true } });
      if (!sale) throw new NotFoundException({ code: "SALE_NOT_FOUND", message: "Savdo topilmadi." });
      if (sale.status === "CANCELLED") throw new ConflictException({ code: "SALE_ALREADY_CANCELLED", message: "Savdo allaqachon bekor qilingan." });
      if (sale.status !== "COMPLETED") throw new ConflictException({ code: "SALE_NOT_COMPLETED", message: "Faqat yakunlangan savdo bekor qilinadi." });

      for (const item of sale.items) {
        const returned = sale.returns.filter((entry) => entry.productId === item.productId).reduce((sum, entry) => sum + toNumber(entry.quantity), 0);
        const restore = roundMoney(toNumber(item.quantity) - returned, 3);
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

      return this.saleDto(updated);
    });
  }

  async returnSale(companyId: string, id: string, body: any) {
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
        const qty = toNumber(item.quantity);
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
    if (body.agentId) {
      const agent = await this.prisma.agent.findFirst({ where: { id: body.agentId, companyId: tenantId, deletedAt: null } });
      if (!agent) throw new NotFoundException({ code: "AGENT_NOT_FOUND", message: "Agent topilmadi." });
    }
    const customer = await this.prisma.customer.create({
      data: {
        companyId: tenantId,
        name: body.name || body.fullName || body.companyName || "Nomsiz mijoz",
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
    const sales = await this.prisma.sale.count({ where: { customerId: id, companyId: tenantId } });
    if (sales > 0) {
      await this.prisma.customer.update({ where: { id, companyId: tenantId }, data: { status: "INACTIVE", deletedAt: new Date() } });
      return { deleted: true, softDelete: true };
    }
    await this.prisma.customer.delete({ where: { id, companyId: tenantId } });
    return { deleted: true, softDelete: false };
  }

  async receiveCustomerPayment(companyId: string, id: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const amount = roundMoney(body.amount);
    const idempotencyKey = body.idempotencyKey || `customer-payment:${id}:${Date.now()}`;
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
    const agent = await this.prisma.agent.create({
      data: {
        companyId: this.requireCompany(companyId),
        name: body.name || body.fullName || "Nomsiz agent",
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
    const boms = await this.prisma.bom.findMany({ where: { companyId: this.requireCompany(companyId) }, include: { materials: true }, orderBy: { createdAt: "desc" } });

    return { boms: boms.map(this.bomDto), data: boms.map(this.bomDto) };
  }

  async createBom(companyId: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const materials = Array.isArray(body.materials) ? body.materials : Array.isArray(body.items) ? body.items : [];
    await this.validateProductIds(this.prisma, tenantId, [body.outputProductId || body.productId, ...materials.map((item: any) => item.productId)]);
    const bom = await this.prisma.bom.create({
      data: {
        companyId: tenantId,
        name: body.name,
        outputProductId: body.outputProductId || body.productId || null,
        outputProductName: body.outputProductName || body.productName,
        outputQuantity: toNumber(body.outputQuantity || body.quantity || 1),
        unit: body.unit || "dona",
        overheadCost: roundMoney(body.overheadCost),
        status: body.status || "ACTIVE",
        materials: {
          create: materials.map((item: any) => ({
            productId: item.productId || null,
            productName: item.productName || item.name || "Material",
            quantity: toNumber(item.quantity),
            unit: item.unit || "dona",
            cost: roundMoney(item.cost),
          })),
        },
      },
      include: { materials: true },
    });

    return this.bomDto(bom);
  }

  async getBom(companyId: string, id: string) {
    const bom = await this.prisma.bom.findFirst({ where: { id, companyId: this.requireCompany(companyId) }, include: { materials: true } });
    if (!bom) throw new NotFoundException({ code: "BOM_NOT_FOUND", message: "BOM topilmadi." });
    return this.bomDto(bom);
  }

  async updateBom(companyId: string, id: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    await this.getBom(companyId, id);
    const materials = body.materials || body.items;
    if (Array.isArray(materials)) {
      await this.validateProductIds(this.prisma, tenantId, [body.outputProductId || body.productId, ...materials.map((item: any) => item.productId)]);
    }
    const bom = await this.prisma.$transaction(async (tx) => {
      if (Array.isArray(materials)) await tx.bomMaterial.deleteMany({ where: { bomId: id } });
      return tx.bom.update({
        where: { id, companyId: tenantId },
        data: {
          name: body.name,
          outputProductId: body.outputProductId || body.productId,
          outputProductName: body.outputProductName || body.productName,
          outputQuantity: body.outputQuantity === undefined && body.quantity === undefined ? undefined : toNumber(body.outputQuantity || body.quantity),
          unit: body.unit,
          overheadCost: body.overheadCost === undefined ? undefined : roundMoney(body.overheadCost),
          status: body.status,
          materials: Array.isArray(materials) ? { create: materials.map((item: any) => ({ productId: item.productId || null, productName: item.productName || item.name || "Material", quantity: toNumber(item.quantity), unit: item.unit || "dona", cost: roundMoney(item.cost) })) } : undefined,
        },
        include: { materials: true },
      });
    });
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
    await this.validateProductIds(this.prisma, tenantId, [body.outputProductId || bom?.outputProductId]);
    if (body.warehouseId) await this.requireWarehouse(this.prisma, tenantId, body.warehouseId);
    const order = await this.prisma.productionOrder.create({
      data: {
        companyId: tenantId,
        number: body.number || (await this.generateNumber(this.prisma, tenantId, "production")),
        bomId: bom?.id || null,
        outputProductId: body.outputProductId || bom?.outputProductId || null,
        outputProductName: body.outputProductName || bom?.outputProductName,
        plannedQuantity: toNumber(body.plannedQuantity || body.quantity || 1),
        warehouseId: body.warehouseId || null,
        overheadCost: roundMoney(body.overheadCost || bom?.overheadCost),
        status: body.status || "PLANNED",
        note: body.note,
        stages: { create: (body.stages || []).map((stage: any) => ({ name: stage.name || String(stage), status: stage.status || "PLANNED" })) },
      },
      include: { bom: { include: { materials: true } }, stages: true },
    });
    return this.productionOrderDto(order);
  }

  async startProduction(companyId: string, id: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findFirst({ where: { id, companyId: tenantId }, include: { bom: { include: { materials: true } } } });
      if (!order) throw new NotFoundException({ code: "PRODUCTION_NOT_FOUND", message: "Ishlab chiqarish topilmadi." });
      if (order.status === "IN_PROGRESS") return this.productionOrderDto(order);
      if (order.status === "COMPLETED" || order.status === "CANCELLED") throw new ConflictException({ code: "PRODUCTION_LOCKED", message: "Bu buyurtmani start qilib bo'lmaydi." });
      if (!order.bom) throw new BadRequestException({ code: "BOM_REQUIRED", message: "BOM topilmadi." });
      const warehouseId = body.warehouseId || order.warehouseId || (await this.ensureDefaultWarehouse(tenantId)).id;
      let materialCost = 0;
      for (const material of order.bom.materials) {
        const qty = roundMoney(toNumber(material.quantity) * toNumber(order.plannedQuantity) / Math.max(toNumber(order.bom.outputQuantity), 1), 3);
        if (material.productId) {
          await this.adjustStockDelta(tx, tenantId, warehouseId, material.productId, -qty, {
            type: "CONSUME",
            reason: "PRODUCTION_START",
            sourceType: "PRODUCTION",
            sourceId: order.id,
          });
        }
        materialCost += roundMoney(qty * toNumber(material.cost));
      }
      const updated = await tx.productionOrder.update({
        where: { id, companyId: tenantId },
        data: { status: "IN_PROGRESS", startedAt: new Date(), materialCost, productionCost: materialCost + toNumber(order.overheadCost) },
        include: { bom: { include: { materials: true } }, stages: true },
      });
      return this.productionOrderDto(updated);
    });
  }

  async completeProduction(companyId: string, id: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findFirst({ where: { id, companyId: tenantId }, include: { bom: true } });
      if (!order) throw new NotFoundException({ code: "PRODUCTION_NOT_FOUND", message: "Ishlab chiqarish topilmadi." });
      if (order.status === "COMPLETED") return this.productionOrderDto(order);
      if (order.status === "CANCELLED") throw new ConflictException({ code: "PRODUCTION_CANCELLED", message: "Bekor qilingan buyurtma yakunlanmaydi." });
      if (order.status !== "IN_PROGRESS") throw new ConflictException({ code: "PRODUCTION_NOT_STARTED", message: "Avval ishlab chiqarishni boshlang." });
      const warehouseId = body.warehouseId || order.warehouseId || (await this.ensureDefaultWarehouse(tenantId)).id;
      const actualQuantity = toNumber(body.actualQuantity || body.quantity || order.plannedQuantity);
      if (!order.outputProductId) throw new BadRequestException({ code: "OUTPUT_PRODUCT_REQUIRED", message: "Output product kerak." });
      await this.adjustStockDelta(tx, tenantId, warehouseId, order.outputProductId, actualQuantity, {
        type: "PRODUCE",
        reason: "PRODUCTION_COMPLETE",
        sourceType: "PRODUCTION",
        sourceId: order.id,
      });
      const productionCost = roundMoney(toNumber(order.productionCost) || toNumber(order.materialCost) + toNumber(order.overheadCost));
      const updated = await tx.productionOrder.update({
        where: { id, companyId: tenantId },
        data: {
          status: "COMPLETED",
          actualQuantity,
          productionCost,
          unitCost: actualQuantity > 0 ? roundMoney(productionCost / actualQuantity) : 0,
          completedAt: new Date(),
        },
        include: { bom: { include: { materials: true } }, stages: true },
      });
      return this.productionOrderDto(updated);
    });
  }

  async cancelProduction(companyId: string, id: string) {
    await this.prisma.productionOrder.updateMany({ where: { id, companyId: this.requireCompany(companyId), status: { not: "COMPLETED" } }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    return this.getProductionOrder(companyId, id);
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

  async payPayroll(companyId: string, id: string, body: any) {
    const tenantId = this.requireCompany(companyId);
    const amount = roundMoney(body.amount);
    const idempotencyKey = body.idempotencyKey || `payroll-payment:${id}:${Date.now()}`;
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
      return this.payrollDto(updated);
    });
  }

  async listPayroll(companyId: string) {
    const payrolls = await this.prisma.payroll.findMany({ where: { companyId: this.requireCompany(companyId) }, orderBy: { createdAt: "desc" } });
    return { payrolls: payrolls.map(this.payrollDto), data: payrolls.map(this.payrollDto) };
  }

  async reports(companyId: string) {
    const tenantId = this.requireCompany(companyId);
    const [sales, products, customers, suppliers, financeIn, financeOut, production, employees] = await Promise.all([
      this.prisma.sale.aggregate({ where: { companyId: tenantId, status: "COMPLETED" }, _sum: { total: true, paidAmount: true, debtAmount: true }, _count: true }),
      this.prisma.product.count({ where: { companyId: tenantId, deletedAt: null } }),
      this.prisma.customer.count({ where: { companyId: tenantId, deletedAt: null } }),
      this.prisma.supplier.count({ where: { companyId: tenantId, deletedAt: null } }),
      this.prisma.financeTransaction.aggregate({ where: { companyId: tenantId, type: "IN" }, _sum: { amount: true } }),
      this.prisma.financeTransaction.aggregate({ where: { companyId: tenantId, type: "OUT" }, _sum: { amount: true } }),
      this.prisma.productionOrder.count({ where: { companyId: tenantId, status: { not: "CANCELLED" } } }),
      this.prisma.employee.count({ where: { companyId: tenantId, status: "ACTIVE", deletedAt: null } }),
    ]);

    return {
      sales: { count: sales._count, total: decimalToNumber(sales._sum.total), paid: decimalToNumber(sales._sum.paidAmount), debt: decimalToNumber(sales._sum.debtAmount) },
      inventory: { products },
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
    const companySettings = await this.prisma.companySetting.findMany({ where: { companyId: tenantId } });
    const userSettings = userId ? await this.prisma.userSetting.findMany({ where: { userId, companyId: tenantId } }) : [];

    return {
      company: Object.fromEntries(companySettings.map((item) => [item.key, item.value])),
      user: Object.fromEntries(userSettings.map((item) => [item.key, item.value])),
    };
  }

  async updateSettings(companyId: string, body: any, userId?: string) {
    const tenantId = this.requireCompany(companyId);
    const scope = body.scope || "company";
    const settings = body.settings || body.value || body;

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
    const amount = toNumber(body.quantity);
    if (!amount) throw new BadRequestException({ code: "INVALID_QUANTITY", message: "Miqdor 0 dan katta bo'lsin." });

    return this.prisma.$transaction(async (tx) => {
      await this.adjustStockDelta(tx, tenantId, body.warehouseId, body.productId, amount, {
        type: amount > 0 ? "IN" : "OUT",
        reason: body.reason,
        sourceType: body.sourceType || "MANUAL",
        sourceId: body.sourceId || `${Date.now()}`,
        idempotencyKey: body.idempotencyKey,
        note: body.note,
        cost: body.cost,
      });

      return this.listStock(tenantId, { warehouseId: body.warehouseId, productId: body.productId });
    });
  }

  private async adjustStockDelta(tx: Tx, companyId: string, warehouseId: string, productId: string, delta: number, movement: any) {
    if (!warehouseId || !productId) throw new BadRequestException({ code: "STOCK_TARGET_REQUIRED", message: "Ombor va mahsulot kerak." });
    await this.requireWarehouse(tx, companyId, warehouseId);
    const item = await this.ensureStockItem(tx, companyId, warehouseId, productId);
    const current = toNumber(item.quantity);
    const reserved = toNumber(item.reserved);
    if (delta < 0 && Math.abs(delta) > Math.max(current - reserved, 0)) {
      throw new ConflictException({ code: "INSUFFICIENT_AVAILABLE_STOCK", message: `Sotish uchun mavjud qoldiq yetarli emas. Mavjud: ${Math.max(current - reserved, 0)}.` });
    }
    const next = roundMoney(current + delta, 3);
    if (next < 0) throw new ConflictException({ code: "NEGATIVE_STOCK", message: `Yetarli qoldiq yo'q. Mavjud: ${current}.` });
    const product = await tx.product.findFirst({ where: { id: productId, companyId, deletedAt: null } });
    if (!product) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: "Mahsulot topilmadi." });
    if (delta < 0 && product.status !== "ACTIVE") {
      throw new ConflictException({ code: "PRODUCT_INACTIVE", message: "Faol bo'lmagan mahsulot sotilmaydi." });
    }

    await tx.stockItem.update({ where: { id: item.id }, data: { quantity: next, cost: movement.cost === undefined ? undefined : toNumber(movement.cost) } });
    await tx.stockMovement.create({
      data: {
        companyId,
        warehouseId,
        productId,
        productName: product.name,
        type: movement.type,
        quantity: Math.abs(delta),
        unit: product.unit,
        cost: movement.cost === undefined ? product.cost : toNumber(movement.cost),
        reason: movement.reason,
        sourceType: movement.sourceType,
        sourceId: movement.sourceId,
        idempotencyKey: movement.idempotencyKey,
        note: movement.note,
        destinationWarehouseId: movement.destinationWarehouseId,
        sourceWarehouseId: movement.sourceWarehouseId,
      },
    });
    await this.refreshProductStock(tx, companyId, productId);
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
        throw new NotFoundException({ code, message: "Finance bog'langan ma'lumotni topmadi." });
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

  private normalizePurchaseItems(items: any[]) {
    if (!items.length) throw new BadRequestException({ code: "PURCHASE_ITEMS_REQUIRED", message: "Xarid itemlari kerak." });
    return items.map((item) => {
      const quantity = toNumber(item.quantity);
      const cost = roundMoney(item.cost ?? item.price);
      if (quantity <= 0) throw new BadRequestException({ code: "INVALID_QUANTITY", message: "Miqdor 0 dan katta bo'lsin." });
      return {
        productId: item.productId || null,
        productName: item.productName || item.name || "Mahsulot",
        sku: item.sku || null,
        quantity,
        unit: item.unit || "dona",
        cost,
        salePrice: item.salePrice === undefined ? null : roundMoney(item.salePrice),
        subtotal: roundMoney(quantity * cost),
      };
    });
  }

  private normalizeSalePayload(body: any) {
    const items = (body.items || []).map((item: any) => {
      const quantity = toNumber(item.quantity);
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
    return {
      ...product,
      stock: decimalToNumber(product.stock),
      minimumStock: decimalToNumber(product.minimumStock),
      cost: decimalToNumber(product.cost),
      salePrice: product.salePrice === null || product.salePrice === undefined ? null : decimalToNumber(product.salePrice),
      tax: decimalToNumber(product.tax),
      discount: decimalToNumber(product.discount),
      supplierName: product.supplier?.name || product.supplierName || null,
    };
  }

  private stockDto(stock: any) {
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
      items: sale.items?.map((item: any) => ({
        ...item,
        quantity: decimalToNumber(item.quantity),
        price: decimalToNumber(item.price),
        cost: decimalToNumber(item.cost),
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
      productName: bom.outputProductName,
      materials: bom.materials?.map((item: any) => ({
        ...item,
        quantity: decimalToNumber(item.quantity),
        cost: decimalToNumber(item.cost),
      })) || [],
    };
  }

  private productionOrderDto(order: any) {
    return {
      ...order,
      plannedQuantity: decimalToNumber(order.plannedQuantity),
      actualQuantity: decimalToNumber(order.actualQuantity),
      materialCost: decimalToNumber(order.materialCost),
      overheadCost: decimalToNumber(order.overheadCost),
      productionCost: decimalToNumber(order.productionCost),
      unitCost: decimalToNumber(order.unitCost),
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
