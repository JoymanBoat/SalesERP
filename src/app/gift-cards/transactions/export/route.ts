import { canManagePricing } from "@/lib/permissions";
import { businessDateInTimeZone } from "@/lib/pos";
import {
  appendGiftCardTransactionCsvRows,
  createGiftCardTransactionCsvAccumulator,
  giftCardTransactionCsvFooter,
  giftCardTransactionCsvHeader,
} from "@/lib/gift-cards";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";

const batchSize = 500;

export async function GET(request: Request) {
  const workspaceOrganizationId = new URL(request.url).searchParams.get("workspaceOrganizationId");
  const { organization, membership } = await getWorkspace({
    feature: "giftCards",
    ...(workspaceOrganizationId !== null ? { organizationId: workspaceOrganizationId } : {}),
    operation: "view",
  });
  if (!canManagePricing(membership.role)) {
    return new Response("Gift card transaction exports are available to owners and managers.", {
      status: 403,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  const businessDate = businessDateInTimeZone(new Date(), organization.timezone);
  const giftCardId = new URL(request.url).searchParams.get("giftCardId");
  const giftCard = giftCardId
    ? await prisma.giftCard.findFirst({
        where: { id: giftCardId, organizationId: organization.id },
        select: { id: true, codeLastFour: true },
      })
    : null;
  if (giftCardId && !giftCard) {
    return new Response("Gift card not found.", {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  const dateFormatter = new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: organization.timezone,
  });
  const encoder = new TextEncoder();
  const accumulator = createGiftCardTransactionCsvAccumulator();
  let headerPending = true;
  let footerPending = false;
  let last: { id: string; createdAt: Date } | undefined;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (headerPending) {
          controller.enqueue(encoder.encode(giftCardTransactionCsvHeader(organization.currency, businessDate)));
          headerPending = false;
          return;
        }
        if (footerPending) {
          controller.enqueue(encoder.encode(giftCardTransactionCsvFooter(accumulator, organization.currency)));
          controller.close();
          return;
        }

        const baseWhere = {
          organizationId: organization.id,
          ...(giftCard ? { giftCardId: giftCard.id } : {}),
        };
        const transactions = await prisma.giftCardTransaction.findMany({
          where: last
            ? {
                AND: [
                  baseWhere,
                  {
                    OR: [
                      { createdAt: { gt: last.createdAt } },
                      { createdAt: last.createdAt, id: { gt: last.id } },
                    ],
                  },
                ],
              }
            : baseWhere,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: batchSize,
          select: {
            id: true,
            giftCardId: true,
            type: true,
            amountDelta: true,
            createdAt: true,
            createdById: true,
            giftCard: { select: { codeLastFour: true } },
            order: { select: { number: true } },
            refund: { select: { order: { select: { number: true } } } },
          },
        });

        if (transactions.length === 0) {
          controller.enqueue(encoder.encode(giftCardTransactionCsvFooter(accumulator, organization.currency)));
          controller.close();
          return;
        }

        const lastTransaction = transactions[transactions.length - 1];
        last = { id: lastTransaction.id, createdAt: lastTransaction.createdAt };
        const creatorIds = [...new Set(transactions.flatMap((transaction) =>
          transaction.createdById ? [transaction.createdById] : [],
        ))];
        const creators = creatorIds.length
          ? await prisma.user.findMany({
              where: { id: { in: creatorIds } },
              select: { id: true, name: true, email: true },
            })
          : [];
        const creatorNames = new Map(creators.map((creator) => [
          creator.id,
          creator.name ?? creator.email ?? "Former user",
        ]));
        const rows = transactions.map((transaction) => ({
          id: transaction.id,
          cardId: transaction.giftCardId,
          codeLastFour: transaction.giftCard.codeLastFour,
          recordedAt: dateFormatter.format(transaction.createdAt),
          createdBy: transaction.createdById ? creatorNames.get(transaction.createdById) ?? "Former user" : "System",
          type: transaction.type,
          amountDelta: transaction.amountDelta.toFixed(2),
          orderNumber: transaction.order?.number ?? transaction.refund?.order.number ?? null,
        }));
        if (transactions.length < batchSize) footerPending = true;
        const csvRows = appendGiftCardTransactionCsvRows(rows, accumulator, organization.currency);
        if (csvRows) controller.enqueue(encoder.encode(csvRows));
      } catch (error) {
        console.error("Gift card transaction export failed.", error);
        controller.error(error);
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gift-card-${giftCard ? `${giftCard.codeLastFour}-` : ""}transactions-${businessDate}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
