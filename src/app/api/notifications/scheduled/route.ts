import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { runScheduledNotifications } from "@/lib/notifications";

export const runtime = "nodejs";

function isAuthorized(request: Request) {
  const secret = process.env.NOTIFICATIONS_CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!secret) return false;
  const expected = Buffer.from(secret);
  const supplied = Buffer.from(token);
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}

export async function POST(request: Request) {
  if (!process.env.NOTIFICATIONS_CRON_SECRET || Buffer.byteLength(process.env.NOTIFICATIONS_CRON_SECRET) < 32) {
    return NextResponse.json(
      { error: "Scheduled notifications are not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await runScheduledNotifications();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Scheduled notifications failed.", error);
    return NextResponse.json(
      { error: "Scheduled notifications could not be completed." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
