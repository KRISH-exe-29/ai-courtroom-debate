import { wrapCase } from "./case";
import type { ModelClient } from "./client";
import {
  blind,
  judgeSystem,
  judgeTranscript,
  lawyerRequest,
  lawyerSystem,
  lawyerTranscript,
  rulingRequest,
  verdictRequest,
  type PlayedTurn,
} from "./prompts";
import { GROUNDS, MAX_OBJECTIONS, START_HP, turnOrder } from "./rubric";
import { RulingInput, VerdictInput } from "./schema";
import { applyRuling, clampVerdict, quoteMatches, type HpState } from "./score";
import type { Case, Lawyer, ObjectionGround, TrialEvent } from "./types";

export type TrialOptions = { first?: Lawyer; random?: () => number; now?: () => number };

type Unstamped = TrialEvent extends infer E ? (E extends TrialEvent ? Omit<E, "at"> : never) : never;

const other = (l: Lawyer): Lawyer => (l === "AEGIS" ? "NEMESIS" : "AEGIS");

/**
 * Runs a full trial and yields its event log as it happens.
 * Never throws: a model failure ends the log with an `error` event.
 */
export async function* runTrial(c: Case, client: ModelClient, opts: TrialOptions = {}): AsyncGenerator<TrialEvent> {
  const now = opts.now ?? Date.now;
  const start = now();
  const stamp = (e: Unstamped) => ({ ...e, at: now() - start }) as TrialEvent;

  const first = opts.first ?? ((opts.random ?? Math.random)() < 0.5 ? "AEGIS" : "NEMESIS");
  yield stamp({ type: "filed", case: c, first });

  const system = judgeSystem();
  async function judge<T>(tool: "ruling" | "verdict", schema: { safeParse(x: unknown): { success: boolean; data?: T } }, prompt: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const parsed = schema.safeParse(await client.callJudge({ system, prompt: blind(prompt, first), tool }));
      if (parsed.success) return parsed.data as T;
    }
    return undefined;
  }

  const played: PlayedTurn[] = [];
  const objectionsUsed: Record<Lawyer, number> = { AEGIS: 0, NEMESIS: 0 };
  let hp: HpState = { AEGIS: START_HP, NEMESIS: START_HP };
  let knockedOut = false;

  try {
    for (const [turn, { lawyer, phase }] of turnOrder(first).entries()) {
      yield stamp({ type: "turn_start", turn, lawyer, phase });

      let text = "";
      let claimed: { ground: ObjectionGround; quote: string } | undefined;
      const prompt = `${lawyerTranscript(c, played)}\n\n${lawyerRequest(lawyer, phase, turn)}`;
      for await (const chunk of client.streamLawyer({ lawyer, system: lawyerSystem(lawyer), prompt })) {
        if (chunk.type === "text") {
          text += chunk.text;
          yield stamp({ type: "speech_delta", turn, text: chunk.text });
        } else {
          claimed ??= { ground: chunk.ground, quote: chunk.quote };
        }
      }
      yield stamp({ type: "turn_end", turn, text });

      const previous = played.at(-1);
      const objection =
        claimed &&
        previous &&
        objectionsUsed[lawyer] < MAX_OBJECTIONS &&
        Object.hasOwn(GROUNDS, claimed.ground) &&
        quoteMatches(claimed.quote, previous.text)
          ? claimed
          : undefined;
      if (objection) {
        objectionsUsed[lawyer]++;
        yield stamp({ type: "objection", turn, by: lawyer, ...objection });
      }

      const priorText = [wrapCase(c), ...played.map((t) => t.text)].join("\n\n");
      played.push({ lawyer, phase, text });

      const ruling = await judge<RulingInput>(
        "ruling",
        RulingInput,
        `${judgeTranscript(c, played, first)}\n\n${rulingRequest(turn, objection)}`,
      );
      if (!ruling) {
        yield stamp({ type: "ruling", turn, penalties: [], dropped: 0, skipped: true });
      } else {
        // The judge quotes the blinded transcript, so match its quotes against the blinded text.
        const result = applyRuling({
          hp, speaker: lawyer, turn, text: blind(text, first), priorText: blind(priorText, first), ruling,
          objectionAgainst: objection ? other(lawyer) : undefined,
        });
        hp = result.hp;
        yield stamp({
          type: "ruling", turn, penalties: result.penalties, dropped: result.dropped,
          ...(objection && ruling.objection ? { objection: ruling.objection } : {}),
        });
        for (const change of result.changes) yield stamp(change);
      }

      const out = (["AEGIS", "NEMESIS"] as const).filter((l) => hp[l] === 0);
      for (const l of out) yield stamp({ type: "knockout", lawyer: l });
      if (out.length) {
        knockedOut = true;
        break;
      }
    }

    const verdict = await judge<VerdictInput>(
      "verdict",
      VerdictInput,
      `${judgeTranscript(c, played, first)}\n\n${verdictRequest({ forSide: hp.AEGIS, againstSide: hp.NEMESIS }, knockedOut)}`,
    );
    yield verdict
      ? stamp({ type: "verdict", ...clampVerdict(verdict, played.length) })
      : stamp({ type: "error", message: "The judge did not return a valid verdict." });
  } catch (e) {
    yield stamp({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
}
