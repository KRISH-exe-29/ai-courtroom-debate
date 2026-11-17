import type { Lawyer, ObjectionGround, OffenceCode, Phase } from "./types";

export const START_HP = 10;
export const MAX_OBJECTIONS = 2;

export const RUBRIC: Record<
  OffenceCode,
  { points: number; label: string; description: string; counts: string; doesNot: string }
> = {
  UNSUPPORTED: {
    points: 1,
    label: "Unsupported claim",
    description: "A claim, including a factual claim, given with no reasoning or basis.",
    counts: "\"Most startups in this space make money within a year.\" (no reason or source given)",
    doesNot: "\"Your two years of savings cover the runway you described, so cash is not the first risk.\"",
  },
  REPETITION: {
    points: 1,
    label: "Repetition",
    description: "Restates an earlier point without adding anything to it.",
    counts: "Saying \"it is too risky\" again in a later turn with the same reasons as before.",
    doesNot: "Returning to risk with a new reason, such as the visa deadline the case mentions.",
  },
  EVASION: {
    points: 1,
    label: "Evasion",
    description: "Ignores the opponent's previous point.",
    counts: "The opponent raised cost; the reply only talks about passion and never mentions cost.",
    doesNot: "\"On cost: the course is free for employees, so that objection falls away.\"",
  },
  FALLACY: {
    points: 2,
    label: "Fallacy",
    description: "A named logical fallacy, including a strawman of the opponent's argument.",
    counts: "\"Everyone who quit a job to start a company regretted it.\" (hasty generalisation)",
    doesNot: "\"Many first-time founders underestimate how long sales take; your plan assumes three months.\"",
  },
  CONTRADICTION: {
    points: 3,
    label: "Contradiction",
    description: "Contradicts the case text, its own earlier turn, or a point both sides accepted.",
    counts: "\"You have no savings\" when the case says \"I have two years of savings\".",
    doesNot: "\"Two years of savings is less than it sounds once rent rises\" (disagrees, does not contradict).",
  },
  SUSTAINED: {
    points: 1,
    label: "Sustained objection",
    description: "An objection against this turn was sustained.",
    counts: "The opponent objected for SPECULATION and the judge agreed the outcome was asserted as certain.",
    doesNot: "An objection the judge overruled.",
  },
};

export const GROUNDS: Record<ObjectionGround, string> = {
  RELEVANCE: "The point does not bear on the case.",
  SPECULATION: "Asserts an unknowable outcome as certain.",
  MISCHARACTERIZATION: "Misstates my argument (a strawman).",
  ASKED_AND_ANSWERED: "Re-raises a point that was already answered.",
  ASSUMES_FACTS: "Relies on a fact that is not in the case or the trial.",
};

const PHASES: Phase[] = ["opening", "opening", ...Array<Phase>(6).fill("rebuttal"), "closing", "closing"];

/** The 10 lawyer turns of a trial, alternating from `first`. */
export function turnOrder(first: Lawyer): { lawyer: Lawyer; phase: Phase }[] {
  const second: Lawyer = first === "AEGIS" ? "NEMESIS" : "AEGIS";
  return PHASES.map((phase, i) => ({ lawyer: i % 2 ? second : first, phase }));
}

/** Markdown rendering of the rubric, shared by the judge prompt and the public rubric page. */
export function rubricText(): string {
  const rows = Object.entries(RUBRIC).map(
    ([code, r]) =>
      `### ${code} (−${r.points}) — ${r.label}\n${r.description}\n- Counts: ${r.counts}\n- Does not count: ${r.doesNot}`,
  );
  return rows.join("\n\n");
}
