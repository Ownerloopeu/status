// The status page's logic, with no network: which services are working,
// their last 30 days, the problems, and the page itself as one HTML file.
// build.mjs fetches HetrixTools' checks and calls this; status.test.mjs tests it.
// The look follows the app's DESIGN.md: IBM Plex Sans, the app's colours and badges.
import { createHash } from "node:crypto";

// What the page shows, and which HetrixTools checks (by their name there) decide it.
export const SERVICES = [
  { name: "QR codes and owner pages", address: "scan.ownerloop.eu", monitors: ["Owner pages - scan.ownerloop.eu"] },
  {
    name: "Brand dashboard",
    address: "app.ownerloop.eu",
    monitors: ["Brand dashboard - app.ownerloop.eu", "Database - app.ownerloop.eu api health"],
  },
];

export const DAYS = 30;
export const TIME_ZONE = "Europe/Copenhagen";
export const STALE_AFTER_MINUTES = 20;
// A day with less than this much uptime is red rather than amber (99% of a day is about 15 minutes).
const BAD_DAY_BELOW = 99;

// One check: "up", "down", "maintenance" or "unknown" (paused, switched off or missing).
function monitorState(monitor) {
  if (!monitor) return "unknown";
  if (monitor.monitor_status === "maint" || monitor.monitor_status === "maint_dnd") return "maintenance";
  if (monitor.monitor_status !== "active") return "unknown";
  return monitor.uptime_status === "down" ? "down" : "up";
}

/** A service is down if any of its checks is down; then maintenance; then unknown. */
export function serviceState(service, monitors) {
  const states = service.monitors.map((name) => monitorState(monitors.find((m) => m.name === name)));
  for (const state of ["down", "maintenance", "unknown"]) if (states.includes(state)) return state;
  return "up";
}

/** Since when a down service has been down (milliseconds), from its checks' last change. */
export function downSince(service, monitors) {
  const times = service.monitors
    .map((name) => monitors.find((m) => m.name === name))
    .filter((m) => monitorState(m) === "down" && m.last_status_change)
    .map((m) => m.last_status_change);
  return times.length ? Math.min(...times) : null;
}

/** The date in Denmark, as YYYY-MM-DD. */
export function danishDate(ms) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(ms);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Denmark's offset from UTC at that moment, as +01:00 or +02:00 (HetrixTools' reports want it). */
export function danishOffset(ms) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, timeZoneName: "longOffset" })
    .formatToParts(ms)
    .find((p) => p.type === "timeZoneName").value;
  return name === "GMT" ? "+00:00" : name.replace("GMT", "");
}

/** The last DAYS dates in Denmark, oldest first, ending today. */
export function lastDays(now) {
  const [y, m, d] = danishDate(now).split("-").map(Number);
  return Array.from({ length: DAYS }, (_, i) => new Date(Date.UTC(y, m - 1, d - (DAYS - 1 - i))).toISOString().slice(0, 10));
}

/** Each day's uptime for a service: the lowest of its checks that day, or null before checking began. */
export function serviceDays(service, monitors, days) {
  const reports = service.monitors.map((name) => monitors.find((m) => m.name === name)?.report ?? {});
  return days.map((date) => {
    const values = reports.map((r) => r[date]).filter((v) => typeof v === "number");
    return { date, percentage: values.length ? Math.min(...values) : null };
  });
}

/** A service's downtimes, overlapping ones joined, newest first. An ongoing one has end null. */
export function serviceProblems(service, monitors, since) {
  const spans = service.monitors
    .flatMap((name) => monitors.find((m) => m.name === name)?.downtimes ?? [])
    .map((d) => ({ start: d.start, end: d.end || Infinity, maintenance: Boolean(d.maintenance) }))
    .filter((d) => d.end >= since)
    .sort((a, b) => a.start - b.start);
  const joined = [];
  for (const span of spans) {
    const last = joined.at(-1);
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
      last.maintenance = last.maintenance && span.maintenance;
    } else joined.push({ ...span });
  }
  return joined.map((p) => ({ ...p, service: service.name, end: p.end === Infinity ? null : p.end })).reverse();
}

// ---- Words and numbers ----

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function formatDate(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function shortDate(isoDate) {
  const [, m, d] = isoDate.split("-").map(Number);
  return `${d} ${MONTHS[m - 1].slice(0, 3)}`;
}

export function formatTime(ms) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
}

export function formatDuration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "less than a minute";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const part = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (!h) return part(m, "minute");
  return m ? `${part(h, "hour")} ${part(m, "minute")}` : part(h, "hour");
}

/** 100%, 99.9% or 99.31%: rounded down, so a day with any downtime never shows as 100%. */
export function formatPercentage(value) {
  if (value >= 100) return "100%";
  return `${(Math.floor(value * 100) / 100).toString()}%`;
}

function escape(text) {
  // Attributes always use double quotes, so apostrophes can stay as they are.
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function when(ms, now) {
  const date = danishDate(ms);
  return date === danishDate(now) ? `${formatTime(ms)} today` : `${formatDate(date)}, ${formatTime(ms)}`;
}

function dayKind(percentage) {
  if (percentage === null) return "none";
  if (percentage >= 100) return "good";
  return percentage < BAD_DAY_BELOW ? "bad" : "some";
}

function joinNames(names) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

// ---- The page ----

// Lucide icons (ISC licence), as in the app's src/ui/icons.tsx.
const ICON = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  circleCheck: '<circle cx="12" cy="12" r="10"/><path d="m16 9-5.5 5.5L8 12"/>',
  circleX: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  circleAlert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  triangleAlert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  wrench:
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
};

function icon(name) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON[name]}</svg>`;
}

const TAGS = {
  up: { tone: "positive", icon: "check", word: "Working" },
  down: { tone: "critical", icon: "circleX", word: "Down" },
  maintenance: { tone: "caution", icon: "wrench", word: "Maintenance" },
  unknown: { tone: "neutral", icon: "info", word: "Not checked" },
};

function tag(state) {
  const t = TAGS[state];
  return `<span class="tag ${t.tone}">${icon(t.icon)}<span>${t.word}</span></span>`;
}

function summary(services, now) {
  const named = (state) => services.filter((s) => s.state === state);
  const down = named("down");
  const maintenance = named("maintenance");
  const unknown = named("unknown");
  if (down.length) {
    const lines = down.map((s) => (s.since ? `${s.name}: down since ${when(s.since, now)}.` : `${s.name}: down.`));
    return { tone: "critical", icon: "circleAlert", title: down.length === services.length ? "Ownerloop isn't working right now" : "Part of Ownerloop isn't working", lines: [...lines, "We've been alerted."] };
  }
  if (maintenance.length) {
    return { tone: "caution", icon: "triangleAlert", title: "Planned maintenance", lines: [`${joinNames(maintenance.map((s) => s.name))}: being maintained right now.`] };
  }
  if (unknown.length) {
    return { tone: "neutral", icon: "info", title: "We can't check everything right now", lines: [`${joinNames(unknown.map((s) => s.name))}: not being checked at the moment.`] };
  }
  return { tone: "positive", icon: "circleCheck", title: "Everything is working", lines: [] };
}

function bars(days) {
  const counted = days.filter((d) => d.percentage !== null);
  const troubled = counted.filter((d) => d.percentage < 100);
  const spoken = !counted.length
    ? "Not checked yet."
    : troubled.length
      ? `Problems on ${troubled.length} of ${counted.length} days: ${troubled.map((d) => `${formatDate(d.date)} (${formatPercentage(d.percentage)} up)`).join(", ")}.`
      : `No problems on any of the ${counted.length} days checked.`;
  const cells = days
    .map((d) => {
      const said = d.percentage === null ? "not checked yet" : `${formatPercentage(d.percentage)} up`;
      return `<span class="${dayKind(d.percentage)}" title="${shortDate(d.date)}: ${said}"></span>`;
    })
    .join("");
  return `<div class="bars" role="img" aria-label="The last ${DAYS} days. ${escape(spoken)}">${cells}</div>`;
}

function average(days) {
  const counted = days.filter((d) => d.percentage !== null);
  if (!counted.length) return "Not checked yet";
  return `${formatPercentage(counted.reduce((sum, d) => sum + d.percentage, 0) / counted.length)} up`;
}

function problemItem(p, now) {
  const start = `${formatDate(danishDate(p.start))}, ${formatTime(p.start)}`;
  const what = p.maintenance ? "planned maintenance" : "down";
  if (p.end === null) {
    return `<li><p class="when">Since ${escape(when(p.start, now))} <span>(still going)</span></p><p>${escape(p.service)}: ${what}.</p></li>`;
  }
  const sameDay = danishDate(p.start) === danishDate(p.end);
  const end = sameDay ? formatTime(p.end) : `${formatDate(danishDate(p.end))}, ${formatTime(p.end)}`;
  return `<li><p class="when">${escape(start)} to ${escape(end)} <span>(${formatDuration(p.end - p.start)})</span></p><p>${escape(p.service)}: ${what}.</p></li>`;
}

const STYLE = `
@font-face{font-family:"IBM Plex Sans";src:url("ibm-plex-sans-latin-variable.woff2") format("woff2");font-weight:100 700;font-style:normal;font-display:swap}
:root{--ink:#111827;--ink-2:#374151;--ink-3:#4b5563;--line:#e5e7eb;--line-soft:#eef0f2;--canvas:#f3f4f6;--surface:#fff;--action:#2563eb;--action-press:#1e40af;
--positive:#166534;--positive-tint:#f0fdf4;--positive-line:#bbf7d0;--caution:#92400e;--caution-mark:#d97706;--caution-tint:#fffbeb;--caution-line:#fde68a;
--critical:#b91c1c;--critical-mark:#dc2626;--critical-tint:#fef2f2;--critical-line:#fecaca;--neutral:#374151;--neutral-tint:#f3f4f6;--data:#3b82f6;--data-track:#e5e7eb;color-scheme:light}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--canvas);color:var(--ink-2);font:400 15px/22px "IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
p{margin:0}
a{color:var(--action);text-underline-offset:2px}
a:hover{color:var(--action-press)}
a:focus-visible{outline:2px solid var(--action);outline-offset:2px;border-radius:2px}
.page{max-width:720px;margin:0 auto;padding:32px 16px 48px}
.logo{display:block;height:28px;width:auto}
h1{margin:28px 0 4px;color:var(--ink);font-size:24px;line-height:32px;letter-spacing:-.012em;font-weight:600;text-wrap:balance}
.lead{margin-bottom:24px;color:var(--ink-3)}
.notice{display:flex;gap:12px;margin-bottom:24px;padding:12px 16px;border:1px solid;border-radius:8px}
.notice>svg{flex:none;width:18px;height:18px;margin-top:2px}
.notice .title{font-weight:600}
.notice .more{margin-top:4px;color:var(--ink-2)}
.notice.positive{background:var(--positive-tint);border-color:var(--positive-line);color:var(--positive)}
.notice.caution{background:var(--caution-tint);border-color:var(--caution-line);color:var(--caution)}
.notice.critical{background:var(--critical-tint);border-color:var(--critical-line);color:var(--critical)}
.notice.neutral{background:var(--surface);border-color:var(--line);color:var(--ink-2)}
.notice[hidden]{display:none}
.panel{margin-bottom:24px;background:var(--surface);border:1px solid var(--line);border-radius:8px}
.panel-head{padding:16px 20px 12px}
h2{margin:0;color:var(--ink);font-size:16px;line-height:24px;font-weight:600}
.caption{margin-top:2px;color:var(--ink-3);font-size:13px;line-height:18px}
.service{padding:16px 20px 20px;border-top:1px solid var(--line-soft)}
.service-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.name{color:var(--ink);font-weight:600}
.address{color:var(--ink-3);font-size:13px;line-height:18px}
.tag{display:inline-flex;flex:none;align-items:center;gap:4px;height:22px;padding:0 8px 0 6px;border-radius:4px;font-size:13px;line-height:18px;font-weight:500;white-space:nowrap}
.tag svg{width:12px;height:12px;flex:none}
.tag.positive{background:var(--positive-tint);color:var(--positive)}
.tag.critical{background:var(--critical-tint);color:var(--critical)}
.tag.caution{background:var(--caution-tint);color:var(--caution)}
.tag.neutral{background:var(--neutral-tint);color:var(--neutral)}
.bars{display:flex;gap:2px;height:32px;margin-top:12px}
.bars span{flex:1;min-width:0;border-radius:2px;background:var(--data)}
.bars .some{background:var(--caution-mark)}
.bars .bad{background:var(--critical-mark)}
.bars .none{background:var(--data-track)}
.bars-foot{display:flex;justify-content:space-between;gap:8px;margin-top:6px;color:var(--ink-3);font-size:13px;line-height:18px}
.bars-foot .mid{color:var(--ink-2);font-weight:500}
.legend{display:flex;flex-wrap:wrap;gap:4px 16px;margin:0;padding:12px 20px 16px;border-top:1px solid var(--line-soft);list-style:none;color:var(--ink-3);font-size:13px;line-height:18px}
.legend li{display:flex;align-items:center;gap:6px}
.legend i{display:block;width:10px;height:10px;border-radius:2px;background:var(--data)}
.legend .some{background:var(--caution-mark)}
.legend .bad{background:var(--critical-mark)}
.legend .none{background:var(--data-track);box-shadow:inset 0 0 0 1px #d1d5db}
.problems{margin:0;padding:0 20px 8px;list-style:none}
.problems li{padding:12px 0;border-top:1px solid var(--line-soft)}
.when{color:var(--ink);font-weight:500}
.when span{color:var(--ink-3);font-weight:400}
.empty{padding:0 20px 16px;color:var(--ink-3)}
footer{color:var(--ink-3);font-size:13px;line-height:18px}
footer p+p{margin-top:8px}
@media (max-width:480px){.page{padding-top:24px}.panel-head{padding:16px 16px 12px}.service{padding:16px 16px 20px}.legend{padding:12px 16px 16px}.problems{padding:0 16px 8px}.empty{padding:0 16px 16px}.bars{gap:1px}}
`.trim();

// Shows a warning when the page is older than it should be (GitHub's timed runs can stop or lag).
function staleScript(updated) {
  return `(function(){var u=${updated},n=document.getElementById("stale");if(Date.now()-u>${STALE_AFTER_MINUTES}*60000)n.hidden=false})();`;
}

function hash(text) {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

/** The whole page. data.monitors comes from build.mjs (or its samples); now is milliseconds. */
export function renderPage(data, now) {
  const days = lastDays(now);
  const since = now - DAYS * 86400000;
  const services = SERVICES.map((service) => ({
    ...service,
    state: serviceState(service, data.monitors),
    since: downSince(service, data.monitors),
    days: serviceDays(service, data.monitors, days),
  }));
  const problems = SERVICES.flatMap((s) => serviceProblems(s, data.monitors, since)).sort((a, b) => b.start - a.start);
  const top = summary(services, now);
  const updated = `${formatDate(danishDate(now))}, ${formatTime(now)}`;
  const script = staleScript(now);

  const serviceRows = services
    .map(
      (s) => `<div class="service">
<div class="service-head"><div><p class="name">${escape(s.name)}</p><p class="address">${escape(s.address)}</p></div>${tag(s.state)}</div>
${bars(s.days)}
<div class="bars-foot" aria-hidden="true"><span>${DAYS} days ago</span><span class="mid">${average(s.days)}</span><span>Today</span></div>
</div>`,
    )
    .join("\n");

  const problemList = problems.length
    ? `<ol class="problems">${problems.map((p) => problemItem(p, now)).join("")}</ol>`
    : `<p class="empty">No problems in the last ${DAYS} days.</p>`;

  const csp = `default-src 'none'; style-src ${hash(STYLE)}; script-src ${hash(script)}; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<title>Ownerloop status</title>
<meta name="description" content="Whether Ownerloop's QR codes, owner pages and brand dashboard are working.">
<link rel="icon" href="favicon.ico">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="preload" href="ibm-plex-sans-latin-variable.woff2" as="font" type="font/woff2" crossorigin>
<style>${STYLE}</style>
</head>
<body>
<div class="page">
<header><img class="logo" src="ownerloop-logo.svg" alt="Ownerloop" width="141" height="28"></header>
<main>
<h1>Ownerloop status</h1>
<p class="lead">Whether QR codes, owner pages and the brand dashboard are working.</p>
<div class="notice caution" id="stale" role="status" hidden>${icon("triangleAlert")}<div><p class="title">This page may be out of date</p><p class="more">It last updated on ${updated} (Danish time). Reload it in a few minutes, or write to <a href="mailto:support@ownerloop.eu">support@ownerloop.eu</a>.</p></div></div>
<div class="notice ${top.tone}">${icon(top.icon)}<div><p class="title">${escape(top.title)}</p>${top.lines.map((l) => `<p class="more">${escape(l)}</p>`).join("")}<p class="more">Updated ${updated} (Danish time).</p></div></div>
<section class="panel" aria-labelledby="services">
<div class="panel-head"><h2 id="services">Services</h2><p class="caption">Each bar is one day of the last ${DAYS} days.</p></div>
${serviceRows}
<ul class="legend"><li><i></i>No problems</li><li><i class="some"></i>Down less than 15 minutes</li><li><i class="bad"></i>Down 15 minutes or more</li><li><i class="none"></i>Not checked yet</li></ul>
</section>
<section class="panel" aria-labelledby="problems">
<div class="panel-head"><h2 id="problems">Problems in the last ${DAYS} days</h2></div>
${problemList}
</section>
</main>
<footer>
<p>Each service is checked every minute from Frankfurt, Amsterdam, London and New York. This page updates about every 5 minutes. Times are Danish time.</p>
<p>Questions: <a href="mailto:support@ownerloop.eu">support@ownerloop.eu</a> · <a href="https://ownerloop.eu">ownerloop.eu</a></p>
</footer>
</div>
<script>${script}</script>
</body>
</html>
`;
}
