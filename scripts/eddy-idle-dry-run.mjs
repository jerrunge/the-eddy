// Read-only rehearsal of eddy-dispatch v2's idle close. Same queries, same
// eight-hour rule, nothing written. Run it before and after the deploy to see
// exactly which loops the backstop will close and which stay live.
//   set -a; source ~/.env.local; set +a; node scripts/eddy-idle-dry-run.mjs
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"); process.exit(2); }
const h = { apikey: key, authorization: "Bearer " + key };
const q = async (p) => (await fetch(`${url}/rest/v1/${p}`, { headers: h })).json();
const IDLE_HOURS = 8;
const open = await q("eddy_episodes?closed_at=is.null&select=id,opened_at&order=opened_at&limit=20");
const cutoff = Date.now() - IDLE_HOURS * 3600000;
const pt = (s) => new Date(s).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
console.log(`open episodes: ${open.length}; the cutoff is anything with no word since ${pt(new Date(cutoff).toISOString())} PT\n`);
for (const ep of open) {
  const last = await q(`eddy_entries?episode_id=eq.${ep.id}&select=at&order=at.desc&limit=1`);
  const lastAt = last[0]?.at ?? ep.opened_at;
  const stale = new Date(lastAt).getTime() <= cutoff;
  const minutes = Math.max(1, Math.round((new Date(lastAt).getTime() - new Date(ep.opened_at).getTime()) / 60000));
  console.log(`${ep.id.slice(0, 8)}  opened ${pt(ep.opened_at)}  last word ${last[0] ? pt(lastAt) : "none"}  ->  ` +
    (stale ? `CLOSE as idle at the last word, ${minutes} min` + (last[0] ? ", then summarize" : ", no summary (nothing was said)") : "LEFT OPEN, still live"));
}
