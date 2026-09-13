// Run a Supabase edge function locally under Node against the real tables, for a read
// test before homebase deploys it. Usage:
//   node scripts/run-edge-local.mjs <function> '<json body>' [bearer]
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the env (source ~/.env.local). The
// Deno globals are stubbed (env, serve); the npm: import is pointed at a local supabase-js.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [fn, bodyArg, bearerArg] = process.argv.slice(2);
if (!fn) { console.error("function name"); process.exit(2); }
const src = readFileSync(new URL(`../supabase/functions/${fn}/index.ts`, import.meta.url), "utf8")
  .replace(/^import "jsr:[^"]+";\s*$/m, "")
  .replace(/"npm:@supabase\/supabase-js@2"/g, JSON.stringify("/Users/jeremyrunge/GitHub/do-board/node_modules/@supabase/supabase-js/dist/index.mjs"));
mkdirSync("/tmp/edge-local", { recursive: true });
writeFileSync(`/tmp/edge-local/${fn}.ts`, src);
execSync(`npx --yes esbuild /tmp/edge-local/${fn}.ts --bundle --platform=node --format=esm --outfile=/tmp/edge-local/${fn}.mjs --log-level=error`, { stdio: "inherit" });
globalThis.Deno = { env: { get: (k) => process.env[k] }, serve: (h) => { globalThis.__handler = h; } };
await import(pathToFileURL(`/tmp/edge-local/${fn}.mjs`).href);
const bearer = bearerArg || process.env.SUPABASE_SERVICE_ROLE_KEY;
const req = new Request("http://local/functions/v1/" + fn, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + bearer }, body: bodyArg || "{}" });
const t0 = Date.now();
const res = await globalThis.__handler(req);
const text = await res.text();
console.error(`HTTP ${res.status} ${text.length}B ${Date.now() - t0}ms`);
process.stdout.write(text);
