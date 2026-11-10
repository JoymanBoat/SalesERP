"use server";

import { OrderStatus } from "@prisma/client";
import { z } from "zod";

import { authBaseUrl } from "@/lib/auth-token";
import { formatGhanaCedis } from "@/lib/currency";
import { prisma } from "@/lib/prisma";
import { createReceiptToken } from "@/lib/receipt-link";
import { getWorkspace } from "@/lib/workspace";

export type ShareReceiptState = { status: "idle" | "error" | "success"; message: string; url?: string; text?: string };

export async function prepareReceiptShare(_previous: ShareReceiptState, formData: FormData): Promise<ShareReceiptState> {
  const parsed = z.string().cuid().safeParse(formData.get("orderId"));
  if (!parsed.success) return { status: "error", message: "Invalid receipt. Please refresh and try again." };
  const { organization, store } = await getWorkspace({ feature: "pos", operation: "change" });
  const order = await prisma.order.findFirst({
    where: { id: parsed.data, organizationId: organization.id, storeId: store.id, status: { in: [OrderStatus.PAID, OrderStatus.PARTIALLY_REFUNDED, OrderStatus.REFUNDED] } },
    select: { id: true, number: true, total: true, status: true },
  });
  if (!order) return { status: "error", message: "This completed sale is not available in the selected store." };

  try {
    const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
    if (!secret || secret.length < 32) throw new Error("A stable authentication secret of at least 32 characters is required.");
    const baseUrl = authBaseUrl();
    if (["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname)) {
      return { status: "error", message: "The receipt URL is set to localhost. Ask your administrator to configure a customer-accessible HTTPS AUTH_URL." };
    }
    const token = createReceiptToken(order.id, secret);
    const url = new URL(`/receipt/${token}`, baseUrl).toString();
    const text = `${organization.name} - Receipt #${order.number}\nTotal: ${formatGhanaCedis(order.total.toString())}\nStatus: ${order.status.replaceAll("_", " ")}\nView receipt (expires in 30 days): ${url}`;
    return { status: "success", message: "Choose SMS or WhatsApp, then confirm and send the message in your phone app.", url, text };
  } catch (error) {
    console.error("Receipt sharing could not be prepared.", error);
    return { status: "error", message: "The receipt link could not be prepared. Please contact your administrator." };
  }
}
