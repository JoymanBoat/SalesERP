const MAX_FAILURES = 8;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED = 10_000;

type Entry = { failures: number; windowStart: number };

// Per-process limiter: it slows password guessing on one instance; use a shared store if the app runs on several.
const attempts = new Map<string, Entry>();

function current(key: string, now: number) {
  const entry = attempts.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    attempts.delete(key);
    return undefined;
  }
  return entry;
}

export function isLoginBlocked(email: string, now = Date.now()) {
  return (current(email, now)?.failures ?? 0) >= MAX_FAILURES;
}

export function recordLoginFailure(email: string, now = Date.now()) {
  const entry = current(email, now);
  if (entry) {
    entry.failures += 1;
    return;
  }
  if (attempts.size >= MAX_TRACKED) {
    const oldest = attempts.keys().next().value;
    if (oldest !== undefined) attempts.delete(oldest);
  }
  attempts.set(email, { failures: 1, windowStart: now });
}

export function clearLoginFailures(email: string) {
  attempts.delete(email);
}

export function resetLoginThrottleForTests() {
  attempts.clear();
}
