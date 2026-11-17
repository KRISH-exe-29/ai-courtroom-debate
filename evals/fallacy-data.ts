import type { ModelClient } from "../lib/engine/client";
import { judgeSystem, judgeTranscript, rulingRequest } from "../lib/engine/prompts";
import { RulingInput } from "../lib/engine/schema";
import { quoteMatches } from "../lib/engine/score";

export type FallacyItem = { label: "fallacy" | "clean"; text: string; source: string };

/** Minimal RFC 4180 CSV parser: quoted fields may contain commas, newlines and doubled quotes. */
export function parseCsv(csv: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && csv[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += ch;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const [header, ...body] = rows;
  return body.filter((r) => r.some((f) => f !== "")).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// Small seeded PRNG so a sample can be reproduced exactly.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** n random LOGIC fallacies (seeded) plus the n highest-quality ArgQ arguments as clean controls. */
export function sampleItems(
  logic: Record<string, string>[],
  argq: Record<string, string>[],
  n: number,
  seed: number,
): FallacyItem[] {
  const rand = mulberry32(seed);
  const fallacies = logic
    .filter((r) => r.source_article?.trim())
    .map((r) => ({ r, k: rand() }))
    .sort((a, b) => a.k - b.k)
    .slice(0, n)
    .map(({ r }) => ({ label: "fallacy" as const, text: r.source_article.trim(), source: `LOGIC:${r.updated_label}` }));
  const clean = argq
    .filter((r) => r.argument?.trim())
    .sort((a, b) => Number(b.WA) - Number(a.WA))
    .slice(0, n)
    .map((r) => ({ label: "clean" as const, text: r.argument.trim(), source: `ArgQ:${r.topic}` }));
  return [...fallacies, ...clean];
}

export function isFlagged(text: string, ruling: RulingInput): boolean {
  return ruling.penalties.some((p) => p.code === "FALLACY" && quoteMatches(p.quote, text));
}

export function fallacyScores(results: { label: FallacyItem["label"]; flagged: boolean }[]) {
  const rate = (label: FallacyItem["label"]) => {
    const xs = results.filter((r) => r.label === label);
    return xs.length ? xs.filter((r) => r.flagged).length / xs.length : NaN;
  };
  return { recall: rate("fallacy"), falsePositiveRate: rate("clean") };
}

const BENCH_CASE = { idea: "Judge the argument made in the opening statement.", context: "" };

/** One judge call per item (one retry). Errors and invalid output mark the item invalid instead of aborting the run. */
export async function judgeItem(client: ModelClient, item: FallacyItem): Promise<FallacyItem & { flagged: boolean; invalid?: true }> {
  const prompt = `${judgeTranscript(BENCH_CASE, [{ lawyer: "AEGIS", phase: "opening", text: item.text }], "AEGIS")}\n\n${rulingRequest(0)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const parsed = RulingInput.safeParse(await client.callJudge({ system: judgeSystem(), prompt, tool: "ruling" }));
      if (parsed.success) return { ...item, flagged: isFlagged(item.text, parsed.data) };
    } catch {
      // counted as invalid below
    }
  }
  return { ...item, flagged: false, invalid: true };
}
