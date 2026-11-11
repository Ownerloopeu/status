// Fails (so GitHub emails admin@ownerloop.eu) when the live page at
// status.ownerloop.eu is more than FRESH_MINUTES old. Runs after every update,
// also when the update decided not to publish (HetrixTools unreachable): a run
// that "succeeds" while the page stands still was found on 10 November 2026.
//
//   node check-fresh.mjs [address]
export const FRESH_MINUTES = 30;

/** When the page last updated, from its own HTML ("var u=<milliseconds>"), or null. */
export function updatedAt(html) {
  const found = /var u=(\d{12,14})\b/.exec(html);
  return found ? new Date(Number(found[1])) : null;
}

/** null when fresh, or why it isn't. */
export function staleness(html, now = new Date()) {
  const updated = updatedAt(html);
  if (!updated) return "The page doesn't say when it last updated.";
  const minutes = Math.round((now.getTime() - updated.getTime()) / 60_000);
  return minutes > FRESH_MINUTES ? `The page hasn't updated for ${minutes} minutes.` : null;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("check-fresh.mjs")) {
  const address = process.argv[2] ?? "https://status.ownerloop.eu/";
  const response = await fetch(address, { cache: "no-store", headers: { "cache-control": "no-cache" } }).catch(() => null);
  const problem = !response ? "The page couldn't be reached." : !response.ok ? `The page answered ${response.status}.` : staleness(await response.text());
  if (problem) {
    console.error(`${problem} See the README, "When the page stands still".`);
    process.exit(1);
  }
  console.log("The live page is up to date.");
}
