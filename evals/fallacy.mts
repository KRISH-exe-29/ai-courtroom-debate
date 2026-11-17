// Fallacy-detection benchmark for the judge: LOGIC fallacies vs. top-rated ArgQ-30k arguments.
// Usage: npm run eval:fallacy -- [--limit N] [--seed 42] [--concurrency 4]
// Datasets are downloaded to evals/data/ (gitignored) — see evals/data/README.md for sources and licenses.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createAnthropicClient, usd } from "../lib/engine/anthropic";
import { fallacyScores, judgeItem, parseCsv, sampleItems } from "./fallacy-data";
import type { Targets } from "./report";
import { buildReport } from "./runner";

const SOURCES = {
  logic: "https://raw.githubusercontent.com/causalNLP/logical-fallacy/main/data/edu_test.csv",
  argq: "https://huggingface.co/datasets/ibm-research/argument_quality_ranking_30k/resolve/main/test.csv",
};

async function dataset(name: keyof typeof SOURCES) {
  const path = `evals/data/${name}.csv`;
  if (!existsSync(path)) {
    const res = await fetch(SOURCES[name]);
    if (!res.ok) throw new Error(`Download failed for ${SOURCES[name]}: HTTP ${res.status}`);
    mkdirSync("evals/data", { recursive: true });
    writeFileSync(path, await res.text());
  }
  return parseCsv(readFileSync(path, "utf8"));
}

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error("Set ANTHROPIC_API_KEY (environment or .env.local) to run the benchmark.");
  process.exit(1);
}
const { values } = parseArgs({ options: { limit: { type: "string" }, seed: { type: "string" }, concurrency: { type: "string" } } });
const n = Number(values.limit ?? 100);
const seed = Number(values.seed ?? 42);
const items = sampleItems(await dataset("logic"), await dataset("argq"), n, seed);

let cost = 0;
const client = createAnthropicClient(key, { onUsage: (u) => (cost += usd(u)) });
console.log(`Judging ${items.length} items…`);
const results: Awaited<ReturnType<typeof judgeItem>>[] = new Array(items.length);
let next = 0;
let done = 0;
await Promise.all(
  Array.from({ length: Number(values.concurrency ?? 4) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await judgeItem(client, items[i]);
      if (++done % 10 === 0) console.log(`[${done}/${items.length}] $${cost.toFixed(4)}`);
    }
  }),
);

// Items the judge could not rule on are excluded from the scores and counted as `invalid`.
const scores = fallacyScores(results.filter((r) => !r.invalid));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync("evals/results/fallacy", { recursive: true });
writeFileSync(
  `evals/results/fallacy/${stamp}.json`,
  JSON.stringify({ scores, n, seed, usd: cost, invalid: results.filter((r) => r.invalid).length, items: results }, null, 2) + "\n",
);
const targets: Targets = JSON.parse(readFileSync("evals/targets.json", "utf8"));
writeFileSync("evals/REPORT.md", buildReport("evals/results", targets));
console.log(`Recall ${(scores.recall * 100).toFixed(1)}% · false positives ${(scores.falsePositiveRate * 100).toFixed(1)}% · $${cost.toFixed(4)}`);
