// Runs the judge evaluation round described in the spec and writes evals/results/<date>.json and evals/REPORT.md.
// Usage: npm run eval -- [--concurrency 4] [--limit N]   (--limit keeps the first N base cases and their variants)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { resolveLocalProvider } from "../lib/node/agent-cli";
import { loadCases } from "./cases";
import { summarize } from "./metrics";
import type { Targets } from "./report";
import { buildReport, planJobs, runEval } from "./runner";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
let provider;
try {
  provider = resolveLocalProvider(process.env);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
const { values } = parseArgs({ options: { concurrency: { type: "string" }, limit: { type: "string" } } });
const jobs = planJobs(loadCases(), values.limit ? Number(values.limit) : undefined);
console.log(`Running ${jobs.length} trials · ${provider.label}`);

const cost = (usd: number) => (Number.isFinite(usd) ? `$${usd.toFixed(4)}` : "cost n/a");
const results = await runEval(jobs, provider.make, {
  concurrency: values.concurrency ? Number(values.concurrency) : 4,
  onDone: (d, t, r) => console.log(`[${d}/${t}] ${r.caseId} (${r.first} first) → ${r.verdict ?? r.error} ${cost(r.usd)}`),
});

const records = results.map((r) => r.record);
const summary = summarize(records);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync("evals/results", { recursive: true });
writeFileSync(
  `evals/results/${stamp}.json`,
  JSON.stringify({ summary, models: provider.label, records, logs: results.map((r) => r.events) }, null, 2) + "\n",
);
const targets: Targets = JSON.parse(readFileSync("evals/targets.json", "utf8"));
writeFileSync("evals/REPORT.md", buildReport("evals/results", targets));
console.log(`\nSaved evals/results/${stamp}.json and evals/REPORT.md · total ${cost(summary.usdTotal)}`);
