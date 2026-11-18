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

export type Marker = { index: number; kind: "penalty" | "objection" | "turning" | "verdict"; label: string };

/**
 * Where the notable moments sit in an event log, for the rewind bar. `index` is the number of
 * events to show so the moment has just happened.
 */
export function timelineMarkers(events: TrialEvent[]): Marker[] {
  const verdict = events.find((e) => e.type === "verdict");
  const turning = verdict?.type === "verdict" ? verdict.turningPoint : -1;
  const markers: Marker[] = [];
  events.forEach((e, i) => {
    if (e.type === "hp_change") markers.push({ index: i + 1, kind: "penalty", label: `${e.lawyer} loses ${-e.delta} HP, turn ${e.turn + 1}` });
    else if (e.type === "objection") markers.push({ index: i + 1, kind: "objection", label: `${e.by} objects, turn ${e.turn + 1}` });
    else if (e.type === "turn_start" && e.turn === turning) markers.push({ index: i + 1, kind: "turning", label: `Turning point, turn ${e.turn + 1}` });
    else if (e.type === "verdict") markers.push({ index: i + 1, kind: "verdict", label: "The verdict" });
  });
  return markers;
}

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
