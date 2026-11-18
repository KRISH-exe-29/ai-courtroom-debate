import type { Lawyer, TrialEvent } from "../engine/types";

/**
 * The judge only ever sees "Side A" (the first speaker) and "Side B", and counts turns from 0
 * ("turn [4]"). Shows its words with the real names and turns counted from 1.
 */
export const unblind = (text: string, first: Lawyer = "AEGIS") =>
  text
    .replace(/\bSide ([AB])\b/g, (_, side: string) => ((side === "A") === (first === "AEGIS") ? "AEGIS" : "NEMESIS"))
    .replace(/\b(turns? )\[(\d+)\]/gi, (_, word: string, n: string) => `${word}${Number(n) + 1}`);

export type Step = { event: TrialEvent; delay: number };

/** Pause before each event type, in ms at 1× speed. */
const PAUSE: Partial<Record<TrialEvent["type"], number>> = {
  filed: 500,
  turn_start: 700,
  turn_end: 250,
  objection: 1800,
  ruling: 900,
  hp_change: 700,
  knockout: 1600,
  verdict: 1200,
};

const WORDS_PER_STEP = 3;
const WORD_DELAY = 45;

/**
 * Turns a recorded event log into timed playback steps. Recorded speeches arrive as one
 * block, so each is split into small word chunks to read as if it were being spoken.
 */
export function playbackSteps(events: TrialEvent[]): Step[] {
  const steps: Step[] = [];
  for (const e of events) {
    if (e.type !== "speech_delta") {
      steps.push({ event: e, delay: PAUSE[e.type] ?? 0 });
      continue;
    }
    const parts = e.text.match(/\S+\s*/g) ?? [e.text];
    for (let i = 0; i < parts.length; i += WORDS_PER_STEP) {
      const text = (i === 0 ? e.text.slice(0, e.text.length - e.text.trimStart().length) : "") + parts.slice(i, i + WORDS_PER_STEP).join("");
      steps.push({ event: { ...e, text }, delay: WORD_DELAY * WORDS_PER_STEP });
    }
  }
  return steps;
}
