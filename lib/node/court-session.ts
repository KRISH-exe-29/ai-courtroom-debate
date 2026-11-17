// A trial played one step at a time by whoever answers the requests: typically a coding agent following
// skills/courtroom/SKILL.md. The real engine runs every step: it replays the saved answers from the start
// and pauses at the first request that has no answer yet. Scoring, blinding and penalties are unchanged.
import { z } from "zod";
import type { ModelClient } from "../engine/client";
import { GROUNDS } from "../engine/rubric";
import { RulingInput, VerdictInput } from "../engine/schema";
import { runTrial } from "../engine/trial";
import type { Case, Lawyer, TrialEvent } from "../engine/types";

export type Request =
  | { kind: "lawyer"; lawyer: Lawyer; system: string; prompt: string }
  | { kind: "judge"; tool: "ruling" | "verdict"; system: string; prompt: string };

type Answer = { kind: "lawyer"; speech: string; objection?: { ground: string; quote: string } } | { kind: "judge"; value: unknown };

export type Session = { case: Case; first: Lawyer; answers: Answer[] };

const LawyerReply = z.object({
  speech: z.string().trim().min(1, "speech must not be empty"),
  objection: z
    .object({ ground: z.enum(["NONE", ...Object.keys(GROUNDS)] as [string, ...string[]]), quote: z.string() })
    .nullish(),
});
const JUDGE = { ruling: RulingInput, verdict: VerdictInput };

export const newSession = (c: Case, first: Lawyer): Session => ({ case: c, first, answers: [] });

class NeedsAnswer extends Error {}

/** Runs the trial as far as the saved answers go. `pending` is the next request, absent once the verdict is in. */
export async function advance(s: Session): Promise<{ events: TrialEvent[]; pending?: Request }> {
  let next = 0;
  let pending: Request | undefined;
  const take = (req: Request) => {
    const a = s.answers[next];
    if (!a) {
      pending = req;
      throw new NeedsAnswer();
    }
    if (a.kind !== req.kind) throw new Error("Saved answers do not match this trial; start a new one.");
    next++;
    return a;
  };
  const client: ModelClient = {
    async *streamLawyer({ lawyer, system, prompt }) {
      const a = take({ kind: "lawyer", lawyer, system, prompt }) as Extract<Answer, { kind: "lawyer" }>;
      yield { type: "text", text: a.speech };
      if (a.objection) yield { type: "objection", ground: a.objection.ground as never, quote: a.objection.quote };
    },
    async callJudge({ system, prompt, tool }) {
      return (take({ kind: "judge", tool, system, prompt }) as Extract<Answer, { kind: "judge" }>).value;
    },
  };

  const events: TrialEvent[] = [];
  for await (const e of runTrial(s.case, client, { first: s.first })) events.push(e);
  if (pending) events.pop(); // the engine reports the pause as an error event
  return { events, pending };
}

/** Validates an answer to `req` and returns the session with it saved. Throws a readable reason when invalid. */
export function recordAnswer(s: Session, req: Request, raw: unknown): Session {
  if (req.kind === "lawyer") {
    const r = LawyerReply.safeParse(raw);
    if (!r.success) throw new Error(`Invalid lawyer answer: ${z.prettifyError(r.error)}`);
    const objection = r.data.objection && r.data.objection.ground !== "NONE" ? r.data.objection : undefined;
    return { ...s, answers: [...s.answers, { kind: "lawyer", speech: r.data.speech, ...(objection && { objection }) }] };
  }
  const r = JUDGE[req.tool].safeParse(raw);
  if (!r.success) throw new Error(`Invalid ${req.tool}: ${z.prettifyError(r.error)}`);
  return { ...s, answers: [...s.answers, { kind: "judge", value: r.data }] };
}

const schemaText = (schema: z.ZodType) => {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return JSON.stringify(rest);
};

/** The request as text for whoever answers it: role, system prompt, prompt, and the JSON shape to reply with. */
export function renderRequest(req: Request): string {
  const who = req.kind === "lawyer" ? `You are ${req.lawyer}, a lawyer in this trial.` : `You are the judge (${req.tool}).`;
  const shape =
    req.kind === "lawyer"
      ? `{"speech": "<your full turn>", "objection": {"ground": "NONE" | ${Object.keys(GROUNDS).map((g) => `"${g}"`).join(" | ")}, "quote": "<opponent's exact words, or empty>"}}`
      : schemaText(JUDGE[req.tool]);
  return [
    `=== ${who}`,
    "--- SYSTEM ---",
    req.system,
    "--- PROMPT ---",
    req.prompt,
    "--- REPLY WITH JSON ONLY ---",
    ...(req.kind === "lawyer" ? ["(There is no `object` tool here: put any objection in the `objection` field.)"] : []),
    shape,
  ].join("\n");
}
