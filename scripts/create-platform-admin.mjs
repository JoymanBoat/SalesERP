import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const input = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128).refine((value) => Buffer.byteLength(value, "utf8") <= 72),
}).safeParse({
  name: process.env.PLATFORM_ADMIN_NAME,
  email: process.env.PLATFORM_ADMIN_EMAIL,
  password: process.env.PLATFORM_ADMIN_PASSWORD,
});
delete process.env.PLATFORM_ADMIN_NAME;
delete process.env.PLATFORM_ADMIN_EMAIL;
delete process.env.PLATFORM_ADMIN_PASSWORD;

if (!input.success) {
  console.error("Enter a valid name, email and a password of 12–128 characters (at most 72 UTF-8 bytes).");
  process.exitCode = 1;
} else if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not configured.");
  process.exitCode = 1;
} else {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  (async () => {
    const passwordHash = await bcrypt.hash(input.data.password, 12);
    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(1467159017)`;
      if (await transaction.platformAdmin.count() !== 0) throw new Error("BOOTSTRAP_ALREADY_COMPLETE");
      const user = await transaction.user.create({
        data: { name: input.data.name, email: input.data.email, passwordHash },
      });
      await transaction.platformAdmin.create({ data: { userId: user.id } });
      await transaction.platformAuditEvent.create({
        data: { actorId: user.id, action: "platform_admin.bootstrapped" },
      });
    });
    console.log("Platform administrator created. Sign in with the new account.");
  })().catch((error) => {
    if (error instanceof Error && error.message === "BOOTSTRAP_ALREADY_COMPLETE") {
      console.error("A platform administrator already exists; bootstrap cannot be repeated.");
    } else {
      console.error("Platform administrator creation failed.", error);
    }
    process.exitCode = 1;
  }).finally(() => prisma.$disconnect());
}
