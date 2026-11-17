import type { Summary } from "./metrics";

export type Targets = Partial<Record<
  "stability" | "positionFlip" | "framingConsistency" | "sycophancyShift" | "quoteValidity" | "fallacyRecall" | "fallacyFalsePositives",
  number
>>;

type Row = { label: string; key?: keyof Targets; get: (s: Summary) => number | undefined; better: "higher" | "lower"; kind: "pct" | "num" | "usd" };

const ROWS: Row[] = [
  { label: "Stability (3 runs agree)", key: "stability", get: (s) => s.stability.unanimous, better: "higher", kind: "pct" },
  { label: "Fleiss' κ", get: (s) => s.stability.fleissKappa, better: "higher", kind: "num" },
  { label: "Position flip", key: "positionFlip", get: (s) => s.positionFlip, better: "lower", kind: "pct" },
  { label: "Framing consistency", key: "framingConsistency", get: (s) => s.framingConsistency, better: "higher", kind: "pct" },
  { label: "Sycophancy shift", key: "sycophancyShift", get: (s) => s.sycophancyShift, better: "lower", kind: "pct" },
  { label: "Quote validity", key: "quoteValidity", get: (s) => s.quoteValidity, better: "higher", kind: "pct" },
  { label: "Fallacy recall", key: "fallacyRecall", get: (s) => s.fallacy?.recall, better: "higher", kind: "pct" },
  { label: "Fallacy false positives", key: "fallacyFalsePositives", get: (s) => s.fallacy?.falsePositiveRate, better: "lower", kind: "pct" },
  { label: "Cost per trial", get: (s) => s.usdPerTrial, better: "lower", kind: "usd" },
];

const missing = (v: number | undefined): v is undefined => v === undefined || Number.isNaN(v);
const minus = (s: string) => s.replace("-", "−");

function fmt(v: number | undefined, kind: Row["kind"]) {
  if (missing(v)) return "n/a";
  if (kind === "pct") return `${(v * 100).toFixed(1)}%`;
  if (kind === "usd") return `$${v.toFixed(4)}`;
  return minus(v.toFixed(2));
}

function delta(v: number | undefined, p: number | undefined, kind: Row["kind"]) {
  if (missing(v) || missing(p)) return "";
  const d = v - p;
  const sign = d > 0 ? "+" : d < 0 ? "−" : "±";
  if (kind === "pct") return `${sign}${Math.abs(d * 100).toFixed(1)} pts`;
  if (kind === "usd") return `${sign}$${Math.abs(d).toFixed(4)}`;
  return `${sign}${Math.abs(d).toFixed(2)}`;
}

export function renderReport(s: Summary, prev?: Summary, targets: Targets = {}, date = new Date().toISOString().slice(0, 10)): string {
  const lines = [
    `# Judge evaluation report`,
    ``,
    `Run ${date} · ${s.n} trials · ${s.errored} errored (excluded) · total cost $${s.usdTotal.toFixed(2)}`,
    ``,
    `| Metric | Value | Target | Change | Status |`,
    `|---|---|---|---|---|`,
  ];
  for (const row of ROWS) {
    const v = row.get(s);
    const t = row.key ? targets[row.key] : undefined;
    const target = t === undefined ? "" : `${row.better === "higher" ? "≥" : "≤"} ${fmt(t, row.kind)}`;
    const status = t === undefined || missing(v) ? "" : (row.better === "higher" ? v >= t : v <= t) ? "PASS" : "FAIL";
    lines.push(`| ${row.label} | ${fmt(v, row.kind)} | ${target} | ${prev ? delta(v, row.get(prev), row.kind) : ""} | ${status} |`);
  }
  lines.push(
    ``,
    `Definitions and the run plan are in docs/specs/2026-11-17-courtroom-ai-design.md (Evaluation). Reproduce with \`npm run eval\` and \`npm run eval:fallacy\`.`,
    ``,
  );
  return lines.join("\n");
}
