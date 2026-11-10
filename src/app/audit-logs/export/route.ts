import { MembershipRole } from "@prisma/client";

import { buildAuditLogWhere } from "@/lib/audit-logs";
import { toCsvCell } from "@/lib/reporting";
import { getWorkspace } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

const batchSize = 500;
const headers = ["Recorded at (UTC)", "Actor", "Action", "Entity type", "Entity ID", "Details"];

export async function GET(request: Request) {
  const { organization } = await getWorkspace({ allowedRoles: [MembershipRole.OWNER], operation: "view" });
  const searchParams = new URL(request.url).searchParams;
  const query = (searchParams.get("q") ?? "").trim().slice(0, 80);
  const action = (searchParams.get("action") ?? "").slice(0, 120);
  const where = buildAuditLogWhere(organization.id, query, action);
  const encoder = new TextEncoder();
  let headerPending = true;
  let last: { id: string; createdAt: Date } | undefined;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (headerPending) {
          controller.enqueue(encoder.encode(`\uFEFF${headers.map(toCsvCell).join(",")}\r\n`));
          headerPending = false;
          return;
        }

        const rows = await prisma.auditLog.findMany({
          where: last
            ? {
                AND: [
                  where,
                  {
                    OR: [
                      { createdAt: { lt: last.createdAt } },
                      { createdAt: last.createdAt, id: { lt: last.id } },
                    ],
                  },
                ],
              }
            : where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: batchSize,
          select: {
            id: true,
            createdAt: true,
            action: true,
            entityType: true,
            entityId: true,
            details: true,
            actor: { select: { name: true, email: true } },
          },
        });

        if (rows.length === 0) {
          controller.close();
          return;
        }

        last = { id: rows[rows.length - 1].id, createdAt: rows[rows.length - 1].createdAt };
        const csvRows = rows.map((row) => [
          row.createdAt.toISOString(),
          row.actor?.name ?? row.actor?.email ?? "Unavailable",
          row.action,
          row.entityType,
          row.entityId ?? "",
          row.details ? JSON.stringify(row.details) : "",
        ]);
        controller.enqueue(encoder.encode(`${csvRows.map((row) => row.map(toCsvCell).join(",")).join("\r\n")}\r\n`));
      } catch (error) {
        console.error("Audit history export failed.", error);
        controller.error(error);
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="audit-history.csv"',
      "Cache-Control": "private, no-store",
    },
  });
}
