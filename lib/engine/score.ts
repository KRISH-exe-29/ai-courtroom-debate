import { RUBRIC } from "./rubric";
import type { EventOf, Lawyer, Penalty } from "./types";
import type { RulingInput, VerdictInput } from "./schema";

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();

/** True when `quote` appears in `text`, ignoring case, spacing and quote style. */
export function quoteMatches(quote: string, text: string): boolean {
  const q = normalise(quote);
  return q.length > 0 && normalise(text).includes(q);
}

export type HpState = Record<Lawyer, number>;
export type HpChange = Omit<EventOf<"hp_change">, "at">;

export function applyRuling(a: {
  hp: HpState;
  speaker: Lawyer;
  turn: number;
  text: string;
  priorText: string;
  ruling: RulingInput;
  objectionAgainst?: Lawyer;
}): { penalties: Penalty[]; dropped: number; changes: HpChange[]; hp: HpState } {
  const hp = { ...a.hp };
  const penalties: Penalty[] = [];
  const changes: HpChange[] = [];
  let dropped = 0;

  const hit = (lawyer: Lawyer, p: Penalty) => {
    const before = hp[lawyer];
    hp[lawyer] = Math.max(0, before - p.points);
    changes.push({ type: "hp_change", lawyer, delta: hp[lawyer] - before, hp: hp[lawyer], reason: p.reason, code: p.code, turn: a.turn });
  };

  for (const p of a.ruling.penalties) {
    // SUSTAINED is only earned through an objection ruling, never handed out directly.
    const valid =
      p.code !== "SUSTAINED" &&
      quoteMatches(p.quote, a.text) &&
      (p.code !== "CONTRADICTION" || (p.evidence !== undefined && quoteMatches(p.evidence, a.priorText)));
    if (!valid) {
      dropped++;
      continue;
    }
    const penalty: Penalty = { code: p.code, points: RUBRIC[p.code].points, reason: p.reason, quote: p.quote };
    if (p.evidence !== undefined) penalty.evidence = p.evidence;
    penalties.push(penalty);
    hit(a.speaker, penalty);
  }

  if (a.ruling.objection === "SUSTAINED" && a.objectionAgainst) {
    hit(a.objectionAgainst, { code: "SUSTAINED", points: RUBRIC.SUSTAINED.points, reason: "Objection sustained.", quote: "" });
  }

  return { penalties, dropped, changes, hp };
}

export function clampVerdict(v: VerdictInput, turnsPlayed: number): Omit<EventOf<"verdict">, "at" | "type"> {
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  return {
    ruling: v.ruling,
    conditions: v.conditions ?? [],
    confidence: clamp(Math.round(v.confidence), 0, 100),
    summary: v.summary,
    turningPoint: clamp(v.turningPoint, 0, Math.max(0, turnsPlayed - 1)),
  };
}
