import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const isCanonicalSku = (value: unknown) => /^\d{6}$/.test(String(value || ""));

const generateSku = async (companyId: string, used: Set<string>) => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const sku = String(100000 + Math.floor(Math.random() * 900000));
    if (used.has(sku)) continue;

    const existing = await prisma.product.findFirst({
      where: { companyId, sku },
      select: { id: true },
    });

    if (!existing) {
      used.add(sku);
      return sku;
    }
  }

  throw new Error(`SKU generation failed for company ${companyId}`);
};

const main = async () => {
  const products = await prisma.product.findMany({
    where: {
      deletedAt: null,
    },
    select: { id: true, companyId: true, sku: true, name: true },
    orderBy: { createdAt: "asc" },
  }).then((items) => items.filter((product) => !isCanonicalSku(product.sku)));

  const byCompany = new Map<string, typeof products>();

  products.forEach((product) => {
    if (!byCompany.has(product.companyId)) byCompany.set(product.companyId, []);
    byCompany.get(product.companyId)?.push(product);
  });

  let updated = 0;

  for (const [companyId, companyProducts] of byCompany.entries()) {
    const existing = await prisma.product.findMany({
      where: { companyId },
      select: { sku: true },
    });
    const used = new Set(existing.map((product) => product.sku).filter(isCanonicalSku));

    for (const product of companyProducts) {
      const sku = await generateSku(companyId, used);
      await prisma.product.update({
        where: { id: product.id },
        data: { sku },
      });
      updated += 1;
      console.log(`${product.name}: ${product.sku} -> ${sku}`);
    }
  }

  console.log(`Updated ${updated} legacy product SKU(s).`);
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
