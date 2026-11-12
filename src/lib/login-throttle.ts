import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

const MAX_FAILURES = 8;

export async function withLoginThrottle<T>(
  prisma: PrismaClient,
  email: string,
  authenticate: (transaction: Prisma.TransactionClient) => Promise<T | null>,
): Promise<T | null> {
  const key = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  const result = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const active = await transaction.$queryRaw<Array<{ failures: number }>>`
      SELECT "failures" FROM "LoginThrottle"
      WHERE "key" = ${key} AND "expiresAt" > CURRENT_TIMESTAMP
    `;
    if ((active[0]?.failures ?? 0) >= MAX_FAILURES) return null;

    const user = await authenticate(transaction);
    if (user === null) {
      await transaction.$executeRaw`
        INSERT INTO "LoginThrottle" ("key", "failures", "expiresAt")
        VALUES (${key}, 1, CURRENT_TIMESTAMP + INTERVAL '15 minutes')
        ON CONFLICT ("key") DO UPDATE SET
          "failures" = CASE WHEN "LoginThrottle"."expiresAt" <= CURRENT_TIMESTAMP THEN 1 ELSE "LoginThrottle"."failures" + 1 END,
          "expiresAt" = CASE WHEN "LoginThrottle"."expiresAt" <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes' ELSE "LoginThrottle"."expiresAt" END
      `;
    } else {
      await transaction.$executeRaw`DELETE FROM "LoginThrottle" WHERE "key" = ${key}`;
    }
    return user;
  }, { maxWait: 10_000, timeout: 30_000 });
  if (Math.random() < 0.01) {
    await prisma.$executeRaw`
      DELETE FROM "LoginThrottle" WHERE "key" IN (
        SELECT "key" FROM "LoginThrottle" WHERE "expiresAt" <= CURRENT_TIMESTAMP LIMIT 100
      ) AND "expiresAt" <= CURRENT_TIMESTAMP
    `;
  }
  return result;
}
