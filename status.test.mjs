// Tests for the status page's logic: node --test
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { SERVICES, danishDate, danishOffset, formatDuration, formatPercentage, lastDays, renderPage, serviceDays, serviceProblems, serviceState } from "./status.mjs";

const [owner, dashboard] = SERVICES;
const check = (name, extra = {}) => ({ name, uptime_status: "up", monitor_status: "active", report: {}, downtimes: [], ...extra });
const all = (extra = {}) => SERVICES.flatMap((s) => s.monitors).map((name) => check(name, extra[name]));

test("a service is down when any of its checks is down", () => {
  const monitors = all({ [dashboard.monitors[1]]: { uptime_status: "down" } });
  assert.equal(serviceState(dashboard, monitors), "down");
  assert.equal(serviceState(owner, monitors), "up");
});

test("maintenance and paused checks aren't shown as down", () => {
  assert.equal(serviceState(owner, all({ [owner.monitors[0]]: { uptime_status: "down", monitor_status: "maint" } })), "maintenance");
  assert.equal(serviceState(owner, all({ [owner.monitors[0]]: { monitor_status: "paused" } })), "unknown");
  assert.equal(serviceState(owner, []), "unknown", "a check that's missing at HetrixTools");
});

test("a day counts the worst of a service's checks, and days before checking are empty", () => {
  const monitors = all({
    [dashboard.monitors[0]]: { report: { "2026-10-24": 100, "2026-10-25": 100 } },
    [dashboard.monitors[1]]: { report: { "2026-10-25": 98.5 } },
  });
  assert.deepEqual(serviceDays(dashboard, monitors, ["2026-10-23", "2026-10-24", "2026-10-25"]), [
    { date: "2026-10-23", percentage: null },
    { date: "2026-10-24", percentage: 100 },
    { date: "2026-10-25", percentage: 98.5 },
  ]);
});

test("overlapping downtimes of one service become one problem, newest first", () => {
  const monitors = all({
    [dashboard.monitors[0]]: { downtimes: [{ start: 1000, end: 5000 }, { start: 20_000, end: 30_000 }] },
    [dashboard.monitors[1]]: { downtimes: [{ start: 4000, end: 8000 }, { start: 40_000, end: null }] },
  });
  assert.deepEqual(
    serviceProblems(dashboard, monitors, 0).map(({ start, end }) => [start, end]),
    [
      [40_000, null],
      [20_000, 30_000],
      [1000, 8000],
    ],
  );
});

test("Danish dates and times follow summer and winter time", () => {
  assert.equal(danishDate(Date.UTC(2026, 9, 24, 22, 30)), "2026-10-25", "00:30 in Denmark (summer time)");
  assert.equal(danishOffset(Date.UTC(2026, 6, 1)), "+02:00");
  assert.equal(danishOffset(Date.UTC(2026, 11, 1)), "+01:00");
  const days = lastDays(Date.UTC(2026, 9, 25, 12));
  assert.equal(days.length, 30);
  assert.equal(days[0], "2026-09-26");
  assert.equal(days.at(-1), "2026-10-25");
});

test("numbers in words", () => {
  assert.equal(formatPercentage(100), "100%");
  assert.equal(formatPercentage(99.999), "99.99%", "a day with any downtime never shows as 100%");
  assert.equal(formatPercentage(98.5), "98.5%");
  assert.equal(formatDuration(20_000), "less than a minute");
  assert.equal(formatDuration(7 * 60_000), "7 minutes");
  assert.equal(formatDuration(61 * 60_000), "1 hour 1 minute");
  assert.equal(formatDuration(120 * 60_000), "2 hours");
});

test("the page says what's down, and loads nothing from other sites", () => {
  const now = Date.UTC(2026, 9, 25, 14, 40);
  const html = renderPage({ monitors: all({ [dashboard.monitors[1]]: { uptime_status: "down", last_status_change: now - 600_000 } }) }, now);
  assert.match(html, /Part of Ownerloop isn't working/);
  assert.match(html, /Brand dashboard: down since 15:30 today\./);
  const loaded = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  for (const url of loaded) assert.ok(!/^(https?:)?\/\//.test(url) || url === "https://ownerloop.eu", `loads ${url}`);
});

test("the page's security rule allows exactly its own style and script", () => {
  const html = renderPage({ monitors: all() }, Date.now());
  const sha = (text) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.ok(csp.includes(sha(html.match(/<style>([\s\S]*?)<\/style>/)[1])), "style hash");
  assert.ok(csp.includes(sha(html.match(/<script>([\s\S]*?)<\/script>/)[1])), "script hash");
  assert.match(html, /Everything is working/);
});
