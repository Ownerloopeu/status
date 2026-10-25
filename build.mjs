// Builds status.ownerloop.eu into the folder site/: reads HetrixTools' checks
// and writes one page (status.mjs). GitHub runs it every 5 minutes
// (.github/workflows/status.yml). On a laptop, without a key:
//   node build.mjs --sample up        (or down, maintenance, new: made-up checks)
// With HetrixTools' read-only key in the environment as HETRIXTOOLS_API_KEY:
//   node build.mjs
import { appendFile, copyFile, mkdir, writeFile } from "node:fs/promises";
import { DAYS, SERVICES, danishOffset, lastDays, renderPage } from "./status.mjs";

const ASSETS = ["ibm-plex-sans-latin-variable.woff2", "ownerloop-logo.svg", "favicon.ico", "apple-touch-icon.png"];
const API = "https://api.hetrixtools.com/v3";

class KeyProblem extends Error {}

async function api(key, path) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(API + path, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
      if (response.status === 401 || response.status === 403) throw new KeyProblem(`HetrixTools refused the key (${response.status}) for ${path.split("?")[0]}`);
      if (response.status === 204) return null;
      if (!response.ok) throw new Error(`HetrixTools answered ${response.status} for ${path.split("?")[0]}`);
      return await response.json();
    } catch (error) {
      if (error instanceof KeyProblem || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
    }
  }
}

// HetrixTools gives times in seconds; the page works in milliseconds.
const ms = (seconds) => (seconds ? seconds * 1000 : null);

async function fromHetrixTools(key, now) {
  const wanted = new Set(SERVICES.flatMap((s) => s.monitors));
  const list = await api(key, "/uptime-monitors?per_page=200");
  const monitors = [];
  for (const m of (list?.monitors ?? []).filter((m) => wanted.has(m.name))) {
    const report = await api(key, `/uptime-monitors/${m.id}/report?days=${DAYS}&timezone=${encodeURIComponent(danishOffset(now))}`);
    const downtimes = await api(key, `/uptime-monitors/${m.id}/downtimes?per_page=200&start_after=${Math.floor((now - DAYS * 86400000) / 1000)}`);
    monitors.push({
      name: m.name,
      uptime_status: m.uptime_status,
      monitor_status: m.monitor_status,
      last_status_change: ms(m.last_status_change),
      report: Object.fromEntries(Object.entries(report?.data ?? {}).map(([date, day]) => [date, day.uptime?.percentage])),
      downtimes: (downtimes?.downtimes ?? []).map((d) => ({ start: ms(d.start), end: ms(d.end), maintenance: d.maintenance })),
    });
  }
  const missing = [...wanted].filter((name) => !monitors.some((m) => m.name === name));
  if (missing.length) console.warn(`No HetrixTools check named: ${missing.join(", ")} (shown as "Not checked")`);
  return { monitors };
}

// Made-up checks, to look at the page without a key.
function sample(kind, now) {
  const days = lastDays(now);
  const minute = 60_000;
  const report = (firstDay, troubled = {}) =>
    Object.fromEntries(days.slice(firstDay).map((date) => [date, troubled[date] ?? 100]));
  const owner = { name: SERVICES[0].monitors[0], uptime_status: "up", monitor_status: "active", last_status_change: now - 20 * 86400000 };
  const login = { name: SERVICES[1].monitors[0], uptime_status: "up", monitor_status: "active", last_status_change: now - 20 * 86400000 };
  const database = { name: SERVICES[1].monitors[1], uptime_status: "up", monitor_status: "active", last_status_change: now - 20 * 86400000 };
  if (kind === "new") {
    for (const m of [owner, login, database]) Object.assign(m, { report: report(DAYS - 1), downtimes: [] });
    return { monitors: [owner, login, database] };
  }
  const blip = now - 9 * 86400000;
  const outage = now - 3 * 86400000;
  owner.report = report(0, { [days[DAYS - 10]]: 99.51 });
  owner.downtimes = [{ start: blip, end: blip + 7 * minute }];
  login.report = report(0);
  login.downtimes = [];
  database.report = report(0, { [days[DAYS - 4]]: 98.6 });
  database.downtimes = [{ start: outage, end: outage + 20 * minute }];
  if (kind === "down") {
    Object.assign(database, { uptime_status: "down", last_status_change: now - 12 * minute });
    database.report[days[DAYS - 1]] = 97.9;
    database.downtimes.push({ start: now - 12 * minute, end: null });
  }
  if (kind === "maintenance") owner.monitor_status = "maint";
  return { monitors: [owner, login, database] };
}

async function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

const now = Date.now();
const sampleKind = process.argv.includes("--sample") ? process.argv[process.argv.indexOf("--sample") + 1] || "up" : null;
let data;
if (sampleKind) data = sample(sampleKind, now);
else {
  const key = process.env.HETRIXTOOLS_API_KEY;
  if (!key) {
    console.error("HETRIXTOOLS_API_KEY is missing. To try the page without it: node build.mjs --sample up");
    process.exit(1);
  }
  try {
    data = await fromHetrixTools(key, now);
  } catch (error) {
    // A key problem needs fixing, so the run fails (GitHub emails). Anything else
    // (HetrixTools briefly unreachable) leaves the last page up, and its own warning
    // shows if that lasts more than 20 minutes.
    console.error(error.message);
    if (error instanceof KeyProblem) process.exit(1);
    await setOutput("built", "no");
    process.exit(0);
  }
}

await mkdir("site", { recursive: true });
await writeFile("site/index.html", renderPage(data, now));
for (const file of ASSETS) await copyFile(`assets/${file}`, `site/${file}`);
await setOutput("built", "yes");
console.log(`Built site/index.html (${data.monitors.length} checks${sampleKind ? `, sample "${sampleKind}"` : ""}).`);
