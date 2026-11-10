import { canManagePricing } from "@/lib/permissions";
import { businessDateInTimeZone } from "@/lib/pos";
import { buildGiftCardBalanceCsv } from "@/lib/gift-cards";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";

export async function GET() {
  const { organization, membership } = await getWorkspace({ feature: "giftCards", operation: "view" });
  if (!canManagePricing(membership.role)) {
    return new Response("Gift card balance exports are available to owners and managers.", {
      status: 403,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  const businessDate = businessDateInTimeZone(new Date(), organization.timezone);
  const cards = await prisma.giftCard.findMany({
    where: { organizationId: organization.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      codeLastFour: true,
      initialBalance: true,
      balance: true,
      active: true,
      expiresAt: true,
      createdAt: true,
    },
  });
  const dateFormatter = new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: organization.timezone,
  });
  const csv = buildGiftCardBalanceCsv(cards.map((card) => {
    const expiresOn = card.expiresAt?.toISOString().slice(0, 10) ?? null;
    const status = !card.active
      ? "Inactive"
      : expiresOn && expiresOn < businessDate
        ? "Expired"
        : "Active";
    return {
      codeLastFour: card.codeLastFour,
      issuedAt: dateFormatter.format(card.createdAt),
      expiresOn,
      status,
      initialBalance: card.initialBalance.toFixed(2),
      balance: card.balance.toFixed(2),
    };
  }), organization.currency, businessDate);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gift-card-balances-${businessDate}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
