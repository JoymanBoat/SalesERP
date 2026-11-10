import autocannon from "autocannon";

// Usage: node scripts/load-test.mjs  (server must already be running, ideally `next start`)
const base = process.env.LOAD_BASE_URL ?? "http://localhost:3100";
const email = "loadtest-owner@example.com";
const password = process.env.LOAD_TEST_PASSWORD ?? "load-test-password-1";
const connections = Number(process.env.LOAD_CONNECTIONS ?? 20);
const duration = Number(process.env.LOAD_DURATION ?? 10);

const jar = new Map();
function remember(response) {
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(";");
    const index = pair.indexOf("=");
    jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

async function login() {
  const csrfResponse = await fetch(`${base}/api/auth/csrf`);
  remember(csrfResponse);
  const { csrfToken } = await csrfResponse.json();
  const response = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieHeader() },
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: base }),
  });
  remember(response);
  const check = await fetch(`${base}/dashboard`, { redirect: "manual", headers: { Cookie: cookieHeader() } });
  if (check.status !== 200) throw new Error(`Login failed (dashboard returned ${check.status}). Is the load-test business seeded?`);
}

const targets = [
  ["dashboard", "/dashboard"],
  ["products list", "/products"],
  ["products search", "/products?q=Load%20product%201234"],
  ["inventory list", "/inventory"],
  ["inventory search (sku)", "/inventory?q=LT-5000"],
  ["inventory low-stock", "/inventory?status=low"],
  ["customers list", "/customers"],
  ["customers search", "/customers?q=customer77"],
  ["pos", "/pos"],
  ["pos transactions", "/pos/transactions"],
  ["reports", "/reports"],
  ["audit logs", "/audit-logs"],
  ["products CSV export", "/products/export"],
];

async function run(path, conns) {
  return autocannon({ url: `${base}${path}`, connections: conns, duration, headers: { Cookie: cookieHeader() } });
}

await login();
const rows = [];
for (const [name, path] of targets) {
  const heavy = path.includes("export");
  const result = await run(path, heavy ? 2 : connections);
  rows.push({
    endpoint: name,
    "req/s": Math.round(result.requests.average),
    "p50 ms": result.latency.p50,
    "p97.5 ms": result.latency.p97_5,
    "p99 ms": result.latency.p99,
    "max ms": result.latency.max,
    "non-2xx": result.non2xx,
    errors: result.errors + result.timeouts,
  });
}
console.table(rows);
console.log(`connections=${connections} (exports: 2), duration=${duration}s per endpoint, base=${base}`);
