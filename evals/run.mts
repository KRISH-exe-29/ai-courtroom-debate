// Runs the judge evaluation round described in the spec and writes evals/results/<date>.json and evals/REPORT.md.
// Usage: npm run eval -- [--concurrency 4] [--limit N]   (--limit keeps the first N base cases and their variants)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createAnthropicClient } from "../lib/engine/anthropic";
import { loadCases } from "./cases";
import { summarize } from "./metrics";
import { renderReport, type Targets } from "./report";
import { planJobs, previousSummary, runEval } from "./runner";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error("Set ANTHROPIC_API_KEY (environment or .env.local) to run the evaluation.");
  process.exit(1);
}
const { values } = parseArgs({ options: { concurrency: { type: "string" }, limit: { type: "string" } } });
const jobs = planJobs(loadCases(), values.limit ? Number(values.limit) : undefined);
console.log(`Running ${jobs.length} trials…`);

const prev = previousSummary();
const results = await runEval(jobs, (onUsage) => createAnthropicClient(key, { onUsage }), {
  concurrency: values.concurrency ? Number(values.concurrency) : 4,
  onDone: (d, t, r) => console.log(`[${d}/${t}] ${r.caseId} (${r.first} first) → ${r.verdict ?? r.error} $${r.usd.toFixed(4)}`),
});

const records = results.map((r) => r.record);
const summary = summarize(records);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync("evals/results", { recursive: true });
writeFileSync(`evals/results/${stamp}.json`, JSON.stringify({ summary, records, logs: results.map((r) => r.events) }, null, 2) + "\n");
const targets: Targets = JSON.parse(readFileSync("evals/targets.json", "utf8"));
writeFileSync("evals/REPORT.md", renderReport(summary, prev, targets));
console.log(`\nSaved evals/results/${stamp}.json and evals/REPORT.md · total $${summary.usdTotal.toFixed(2)}`);
