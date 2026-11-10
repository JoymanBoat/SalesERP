import { describe, expect, it } from "vitest";

import {
  getBusinessDate,
  getBusinessDateRange,
  getPreviousBusinessDate,
  getWeeklyNotificationBucket,
} from "./notification-time";

describe("notification business dates", () => {
  it("uses each workspace timezone to select the current business date", () => {
    const now = new Date("2026-11-06T00:15:00.000Z");

    expect(getBusinessDate(now, "Africa/Accra")).toBe("2026-11-06");
    expect(getBusinessDate(now, "America/Los_Angeles")).toBe("2026-11-05");
  });

  it("returns UTC bounds for a local business day", () => {
    expect(getBusinessDateRange("2026-11-06", "Africa/Accra")).toEqual({
      start: new Date("2026-11-06T00:00:00.000Z"),
      end: new Date("2026-11-07T00:00:00.000Z"),
    });
    expect(getBusinessDateRange("2026-11-06", "America/Los_Angeles")).toEqual({
      start: new Date("2026-11-06T08:00:00.000Z"),
      end: new Date("2026-11-07T08:00:00.000Z"),
    });
  });

  it("uses the correct daylight-saving boundary for a local business day", () => {
    expect(getBusinessDateRange("2026-03-08", "America/Los_Angeles")).toEqual({
      start: new Date("2026-03-08T08:00:00.000Z"),
      end: new Date("2026-03-09T07:00:00.000Z"),
    });
  });

  it("selects the preceding business day and stable weekly reminder bucket", () => {
    expect(getPreviousBusinessDate("2026-11-06")).toBe("2026-11-05");
    expect(getWeeklyNotificationBucket("2026-11-06")).toBe("2026-11-02");
    expect(getWeeklyNotificationBucket("2026-11-08")).toBe("2026-11-02");
  });
});
