import Link from "next/link";

import { PosTerminal } from "@/components/pos-terminal";
import { VoidSaleForm } from "@/components/void-sale-form";
import { WorkspaceShell } from "@/components/workspace-shell";
import { canManagePricing, canOperateRegister } from "@/lib/permissions";
import { availableInventoryQuantity, businessDateInTimeZone } from "@/lib/pos";
import { prisma } from "@/lib/prisma";
import { resolveTaxRatesAt } from "@/lib/tax";
import { getWorkspace } from "@/lib/workspace";

export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  const { session, membership, organization, store, register } = await getWorkspace({ feature: "pos", operation: "view" });
  const { draft: draftId } = await searchParams;
  const canOperate = canOperateRegister(membership.role);
  const shift = await prisma.registerShift.findFirst({
    where: { organizationId: organization.id, storeId: store.id, registerId: register?.id ?? "__no_register__", closedAt: null },
    select: { id: true },
  });
  const [variants, customers, drafts, selectedDraft, promotions, taxHistoryRows] = await Promise.all([
    prisma.productVariant.findMany({
      where: {
        organizationId: organization.id,
        product: { archivedAt: null },
      },
      orderBy: [{ product: { name: "asc" } }, { name: "asc" }],
      take: 500,
      select: {
        id: true,
        productId: true,
        name: true,
        sku: true,
        barcode: true,
        unitPrice: true,
        trackInventory: true,
        product: { select: { name: true, taxTreatment: true } },
        inventoryLevels: {
          where: { organizationId: organization.id, storeId: store.id },
          select: { quantity: true, reserved: true },
          take: 1,
        },
      },
    }),
    prisma.customer.findMany({
      where: { organizationId: organization.id, archivedAt: null },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      take: 200,
      select: { id: true, firstName: true, lastName: true, loyaltyPoints: true },
    }),
    prisma.order.findMany({
      where: { organizationId: organization.id, storeId: store.id, registerShiftId: shift?.id ?? "__no_open_shift__", status: "DRAFT" },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 20,
      include: { items: { orderBy: { id: "asc" } }, customer: { select: { firstName: true, lastName: true } } },
    }),
    draftId
      ? prisma.order.findFirst({
          where: { id: draftId, organizationId: organization.id, storeId: store.id, registerShiftId: shift?.id ?? "__no_open_shift__", status: "DRAFT" },
          include: {
            items: { orderBy: { id: "asc" } },
            inventoryReservations: { select: { variantId: true, quantity: true } },
            giftCard: { select: { codeLastFour: true } },
          },
        })
      : Promise.resolve(null),
    prisma.promotion.findMany({
      where: {
        organizationId: organization.id,
        active: true,
      },
      orderBy: { code: "asc" },
      select: {
        code: true,
        name: true,
        type: true,
        value: true,
        minimumSubtotal: true,
        startsOn: true,
        endsOn: true,
        maxRedemptions: true,
        redemptionCount: true,
        products: { select: { productId: true } },
      },
    }),
    prisma.taxRateSetting.findMany({
      where: { organizationId: organization.id },
      orderBy: [{ effectiveFrom: "desc" }, { component: "asc" }],
      take: 60,
      select: { component: true, rate: true, effectiveFrom: true },
    }),
  ]);
  const businessDate = businessDateInTimeZone(new Date(), organization.timezone);
  const taxHistory = taxHistoryRows.map((entry) => ({
    component: entry.component,
    rate: entry.rate.toFixed(2),
    effectiveFrom: entry.effectiveFrom.toISOString().slice(0, 10),
  }));
  const taxRates = resolveTaxRatesAt(taxHistory, businessDate);
  const selectedReservations = new Map(
    selectedDraft?.inventoryReservations.map((reservation) => [reservation.variantId, reservation.quantity]) ?? [],
  );
  const products = variants.map((variant) => {
    const level = variant.inventoryLevels[0];
    const ownReservation = selectedReservations.get(variant.id) ?? 0;
    return {
      id: variant.id,
      productId: variant.productId,
      name: `${variant.product.name}${variant.name === "Default" ? "" : ` · ${variant.name}`}`,
      sku: variant.sku,
      barcode: variant.barcode,
      price: variant.unitPrice.toString(),
      taxTreatment: variant.product.taxTreatment,
      available: variant.trackInventory ? availableInventoryQuantity(level?.quantity ?? 0, level?.reserved ?? 0, ownReservation) : null,
      inventoryMissing: variant.trackInventory && !level,
    };
  });
  const draftTotals = selectedDraft
    ? {
        subtotal: selectedDraft.subtotal.toString(),
        discountTotal: selectedDraft.discountTotal.toString(),
        taxTotal: selectedDraft.taxTotal.toString(),
        total: selectedDraft.total.toString(),
      }
    : null;
  const money = (value: string) => `${organization.currency} ${Number(value).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dateFormatter = new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: organization.timezone,
  });

  return (
    <WorkspaceShell
      activeSection="pos"
      membershipId={membership.id}
      organizationId={organization.id}
      currency={organization.currency}
      organizationName={organization.name}
      role={membership.role}
      storeId={store.id}
      storeName={store.name}
      userName={session.user.name ?? session.user.email ?? "User"}
    >
      <header className="workspace-header">
        <div>
          <p className="breadcrumbs"><Link href="/dashboard">Workspace</Link> / Point of sale</p>
          <h1>Point of sale</h1>
          <p className="header-note">Held carts reserve tracked stock until checkout or void. Cash and stored-value gift cards are accepted at {register?.name ?? "an assigned POS register"} in {store.name}; external payment providers are not connected.</p>
        </div>
        <div className="header-store">{shift ? "Register open" : "Register closed"}<span>{register?.code ?? "No register assigned"}</span></div>
      </header>

      <div className="pos-toolbar">
        <Link className="report-export-link" href="/pos/transactions">Transaction history</Link>
        <Link className="report-export-link" href="/register-shifts">Manage register shifts</Link>
        {canManagePricing(membership.role) && <Link className="report-export-link" href="/gift-cards">Manage gift cards</Link>}
      </div>

      {!register && <p className="permission-note">You do not have POS register access at this store. Ask an owner to assign you to an active register.</p>}
      {register && !shift && <p className="permission-note">Open a shift on {register.name} before saving or completing a sale. <Link href="/register-shifts">Open register shifts</Link></p>}
      {shift && canOperate && register && (
        <PosTerminal
          key={selectedDraft?.id ?? "new"}
          products={products}
          customers={customers.map((customer) => ({
            id: customer.id,
            name: `${customer.firstName}${customer.lastName ? ` ${customer.lastName}` : ""}`,
            loyaltyPoints: Number(customer.loyaltyPoints),
          }))}
          taxRates={taxRates}
          currency={organization.currency}
          canDiscount={canManagePricing(membership.role)}
          businessDate={businessDate}
          promotions={promotions
            .filter((promotion) => promotion.maxRedemptions === null || promotion.redemptionCount < promotion.maxRedemptions)
            .map((promotion) => ({
              code: promotion.code,
              name: promotion.name,
              type: promotion.type,
              value: promotion.value.toString(),
              minimumSubtotal: promotion.minimumSubtotal.toString(),
              startsOn: promotion.startsOn?.toISOString().slice(0, 10) ?? null,
              endsOn: promotion.endsOn?.toISOString().slice(0, 10) ?? null,
              eligibleProductIds: promotion.products.map(({ productId }) => productId),
            }))}
          offlineCartScope={{
            organizationId: organization.id,
            storeId: store.id,
            registerId: register.id,
            membershipId: membership.id,
          }}
          initialDraft={selectedDraft && draftTotals ? {
            id: selectedDraft.id,
            customerId: selectedDraft.customerId,
            updatedAt: selectedDraft.updatedAt.toISOString(),
            giftCardId: selectedDraft.giftCardId,
            giftCardLastFour: selectedDraft.giftCard?.codeLastFour ?? null,
            giftCardRedeemed: selectedDraft.giftCardRedeemed.toString(),
            discountTotal: draftTotals.discountTotal,
            promotionCode: selectedDraft.promotionCode ?? "",
            loyaltyPointsRedeemed: Number(selectedDraft.loyaltyPointsRedeemed),
            notes: selectedDraft.notes ?? "",
            total: draftTotals.total,
            lines: selectedDraft.items.map((item) => ({ variantId: item.variantId ?? "", quantity: item.quantity })),
          } : undefined}
        />
      )}
      {!canOperate && <p className="permission-note">Your role can view transactions but cannot operate the register.</p>}

      <section className="data-panel pos-drafts-panel" aria-labelledby="held-sales-heading">
        <div className="panel-title-row"><div><h2 id="held-sales-heading">Held carts</h2><p>Unpaid drafts attached to the current store's register shift.</p></div><span className="table-count">{drafts.length} held</span></div>
        <div className="pos-held-list">
          {drafts.map((draft) => (
            <article key={draft.id} className="pos-held-card">
              <div><strong>Sale #{draft.number} · {draft.customer ? `${draft.customer.firstName} ${draft.customer.lastName ?? ""}`.trim() : "Walk-in"}</strong><small>{dateFormatter.format(draft.updatedAt)} · {draft.items.length} lines · {money(draft.total.toString())}</small></div>
              <div className="pos-held-actions">
                <Link className="button-quiet" href={`/pos?draft=${encodeURIComponent(draft.id)}`}>Resume</Link>
                {canManagePricing(membership.role) && <VoidSaleForm orderId={draft.id} number={draft.number} />}
              </div>
            </article>
          ))}
          {drafts.length === 0 && <p className="report-empty">No held carts for this store.</p>}
        </div>
      </section>
      <footer className="workspace-footer"><span>{organization.name}</span><span>{store.name} · {organization.currency}</span></footer>
    </WorkspaceShell>
  );
}
