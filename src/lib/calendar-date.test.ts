import { describe, expect, it } from "vitest";

import { isCalendarDate } from "./calendar-date";

describe("ISO calendar date validation", () => {
  it("accepts valid dates including leap days and year boundaries", () => {
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2026-01-01")).toBe(true);
    expect(isCalendarDate("2026-12-31")).toBe(true);
  });

  it("rejects impossible dates and non-canonical formats", () => {
    expect(isCalendarDate("2025-02-29")).toBe(false);
    expect(isCalendarDate("2026-04-31")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-1-01")).toBe(false);
    expect(isCalendarDate("05-11-2026")).toBe(false);
    expect(isCalendarDate("")).toBe(false);
  });
});
