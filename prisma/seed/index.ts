import * as bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

import { PLATFORM_MODULES } from "../../src/common/constants/modules.constants";
import { DEFAULT_PERMISSIONS } from "../../src/common/constants/permissions.constants";
import { ROLES } from "../../src/common/constants/roles.constants";
import { SUPER_ADMIN_ROLE } from "../../src/common/constants/user-role.constants";

const prisma = new PrismaClient();

async function main() {
  for (const module of PLATFORM_MODULES) {
    await prisma.platformModule.upsert({
      where: { key: module.key },
      update: {
        name: module.name,
        locked: Boolean(module.locked),
      },
      create: {
        key: module.key,
        name: module.name,
        locked: Boolean(module.locked),
        enabled: true,
      },
    });
  }

  for (const permission of DEFAULT_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission },
      update: { name: permission },
      create: { key: permission, name: permission },
    });
  }

  for (const role of ROLES) {
    await prisma.role.upsert({
      where: {
        companyId_key: {
          companyId: "platform",
          key: role,
        },
      },
      update: { name: role },
      create: { companyId: "platform", key: role, name: role },
    });
  }

  const email = String(process.env.SUPER_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.SUPER_ADMIN_PASSWORD || "");

  if (!email || !password) {
    throw new Error("SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are required to seed the platform administrator.");
  }

  if (password.length < 8) {
    throw new Error("SUPER_ADMIN_PASSWORD must contain at least 8 characters.");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const existingSuperAdmin = await prisma.user.findFirst({
    where: {
      email: {
        equals: email,
        mode: "insensitive",
      },
    },
    select: { id: true },
  });

  if (existingSuperAdmin) {
    await prisma.user.update({
      where: { id: existingSuperAdmin.id },
      data: {
        email,
        passwordHash,
        role: SUPER_ADMIN_ROLE,
        status: "ACTIVE",
        deletedAt: null,
      },
    });
  } else {
    await prisma.user.create({
      data: {
        fullName: "Super Admin",
        email,
        passwordHash,
        role: SUPER_ADMIN_ROLE,
        status: "ACTIVE",
      },
    });
  }
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
