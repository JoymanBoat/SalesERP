export function getBusinessDate(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getBusinessDateRange(date: string, timeZone: string) {
  const start = getBusinessDateRangeStart(date, timeZone);
  const nextDate = new Date(`${date}T00:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const nextDateText = nextDate.toISOString().slice(0, 10);
  return { start, end: getBusinessDateRangeStart(nextDateText, timeZone) };
}

function getBusinessDateRangeStart(date: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const desiredUtcMidnight = Date.UTC(year, month - 1, day);
  let start = desiredUtcMidnight;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(start)).map(({ type, value }) => [type, value]));
    const representedAsUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    );
    start += desiredUtcMidnight - representedAsUtc;
  }

  return new Date(start);
}

export function getPreviousBusinessDate(date: string) {
  const previous = new Date(`${date}T00:00:00.000Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}

export function getWeeklyNotificationBucket(date: string) {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  const mondayOffset = (day + 6) % 7;
  const monday = new Date(`${date}T00:00:00.000Z`);
  monday.setUTCDate(monday.getUTCDate() - mondayOffset);
  return monday.toISOString().slice(0, 10);
}
