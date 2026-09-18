// Run a Supabase edge function locally under Node against the real tables, for a read
// test before homebase deploys it. Usage:
//   node scripts/run-edge-local.mjs <function> '<json body>' [bearer]
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the env (source ~/.env.local). The
// Deno globals are stubbed (env, serve); every npm: import is resolved to a real
// package on this machine and left external, so Node loads it instead of esbuild
// inlining it (the Anthropic SDK and web-push both break when inlined).
// Packages come from do-board's node_modules by default; point EDGE_LOCAL_NODE_PATH
// at another install for anything it does not carry.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const [fn, bodyArg, bearerArg] = process.argv.slice(2);
if (!fn) { console.error("function name"); process.exit(2); }

const NODE_PATHS = ["/Users/jeremyrunge/GitHub/do-board/node_modules", process.env.EDGE_LOCAL_NODE_PATH].filter(Boolean);
const externals = [];
function resolvePkg(pkg) {
  try {
    const p = require.resolve(pkg, { paths: NODE_PATHS });
    externals.push(p);
    return p;
  } catch {
    console.error(`cannot resolve ${pkg} from ${NODE_PATHS.join(" or ")}; npm install it there`);
    process.exit(3);
  }
}
const src = readFileSync(new URL(`../supabase/functions/${fn}/index.ts`, import.meta.url), "utf8")
  .replace(/^import "jsr:[^"]+";\s*$/m, "")
  .replace(/"npm:((?:@[^/"]+\/)?[^"@]+)(@[^"]*)?"/g, (_m, pkg) => JSON.stringify(resolvePkg(pkg)));

mkdirSync("/tmp/edge-local", { recursive: true });
writeFileSync(`/tmp/edge-local/${fn}.ts`, src);
const ext = externals.map((p) => `--external:${JSON.stringify(p)}`).join(" ");
execSync(`npx --yes esbuild /tmp/edge-local/${fn}.ts --bundle --platform=node --format=esm ${ext} --outfile=/tmp/edge-local/${fn}.mjs --log-level=error`, { stdio: "inherit" });
globalThis.Deno = { env: { get: (k) => process.env[k] }, serve: (h) => { globalThis.__handler = h; } };
await import(pathToFileURL(`/tmp/edge-local/${fn}.mjs`).href);
const bearer = bearerArg || process.env.SUPABASE_SERVICE_ROLE_KEY;
const req = new Request("http://local/functions/v1/" + fn, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + bearer }, body: bodyArg || "{}" });
const t0 = Date.now();
const res = await globalThis.__handler(req);
const text = await res.text();
console.error(`HTTP ${res.status} ${text.length}B ${Date.now() - t0}ms`);
process.stdout.write(text);
