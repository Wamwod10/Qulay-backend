import * as bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

import { PLATFORM_MODULES } from "../../src/common/constants/modules.constants";
import { DEFAULT_PERMISSIONS } from "../../src/common/constants/permissions.constants";
import { ROLES } from "../../src/common/constants/roles.constants";

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

  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (email && password) {
    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.user.upsert({
      where: { email: email.trim().toLowerCase() },
      update: {
        passwordHash,
        role: "SUPER_ADMIN",
        status: "ACTIVE",
      },
      create: {
        fullName: "Super Admin",
        email: email.trim().toLowerCase(),
        passwordHash,
        role: "SUPER_ADMIN",
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
