import { z } from "zod";
import { MAX_CONTEXT, MAX_IDEA } from "../engine/case";
import { reduceEvents } from "../engine/reduce";
import type { TrialEvent } from "../engine/types";

/** Saved trials are a few dozen KB; anything far bigger is not a trial. */
export const MAX_FILE_BYTES = 2_000_000;
const MAX_EVENTS = 20_000;
const TEXT = 20_000;

export class TrialFileError extends Error {}

const lawyer = z.enum(["AEGIS", "NEMESIS"]);
const code = z.enum(["UNSUPPORTED", "REPETITION", "EVASION", "FALLACY", "CONTRADICTION", "SUSTAINED"]);
const ground = z.enum(["RELEVANCE", "SPECULATION", "MISCHARACTERIZATION", "ASKED_AND_ANSWERED", "ASSUMES_FACTS"]);
const turn = z.number().int().min(0).max(100);
const text = (max = TEXT) => z.string().max(max);
const at = { at: z.number().finite().min(0) };

const TrialEventSchema = z.discriminatedUnion("type", [
  z.object({ ...at, type: z.literal("filed"), case: z.object({ idea: text(MAX_IDEA).min(1), context: text(MAX_CONTEXT) }), first: lawyer }),
  z.object({ ...at, type: z.literal("turn_start"), turn, lawyer, phase: z.enum(["opening", "rebuttal", "closing"]) }),
  z.object({ ...at, type: z.literal("speech_delta"), turn, text: text() }),
  z.object({ ...at, type: z.literal("turn_end"), turn, text: text() }),
  z.object({ ...at, type: z.literal("objection"), turn, by: lawyer, ground, quote: text(2000) }),
  z.object({
    ...at,
    type: z.literal("ruling"),
    turn,
    penalties: z
      .array(z.object({ code, points: z.number().int().min(0).max(10), reason: text(4000), quote: text(4000), evidence: text(4000).optional() }))
      .max(20),
    dropped: z.number().int().min(0).max(100),
    objection: z.enum(["SUSTAINED", "OVERRULED"]).optional(),
    skipped: z.literal(true).optional(),
  }),
  z.object({ ...at, type: z.literal("hp_change"), lawyer, delta: z.number().int().min(-10).max(0), hp: z.number().int().min(0).max(10), reason: text(4000), code, turn }),
  z.object({ ...at, type: z.literal("knockout"), lawyer }),
  z.object({
    ...at,
    type: z.literal("verdict"),
    ruling: z.enum(["FOR", "AGAINST", "CONDITIONAL"]),
    conditions: z.array(text(2000)).max(20),
    confidence: z.number().min(0).max(100),
    summary: text(8000),
    turningPoint: turn,
  }),
  z.object({ ...at, type: z.literal("error"), message: text(4000) }),
]);

const FileSchema = z.object({
  format: z.literal("courtroom-trial"),
  version: z.literal(1),
  events: z.array(TrialEventSchema).min(1).max(MAX_EVENTS),
});

/** The file a trial is saved as. */
export function toTrialFile(events: TrialEvent[]): string {
  return JSON.stringify({ format: "courtroom-trial", version: 1, events }, null, 2);
}

export function trialFileName(idea: string): string {
  const slug = idea.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "trial";
  return `courtroom-trial-${slug}.json`;
}

/**
 * Reads a saved trial. The file comes from anyone, so every event is checked against the trial
 * format and the log must start with the case being filed. Also accepts a bare event array,
 * the format the terminal courtroom writes to trials-out/.
 */
export function parseTrialFile(raw: string): TrialEvent[] {
  if (raw.length > MAX_FILE_BYTES) throw new TrialFileError("That file is too large to be a saved trial.");
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new TrialFileError("That file isn't a saved trial: it isn't valid JSON.");
  }
  const parsed = FileSchema.safeParse(Array.isArray(data) ? { format: "courtroom-trial", version: 1, events: data } : data);
  if (!parsed.success) throw new TrialFileError("That file isn't a saved trial, or it was changed after saving.");
  const events = parsed.data.events as TrialEvent[];
  if (events[0].type !== "filed" || events.filter((e) => e.type === "filed").length !== 1) {
    throw new TrialFileError("That trial file is incomplete: it doesn't start with the case.");
  }
  reduceEvents(events);
  return events;
}
