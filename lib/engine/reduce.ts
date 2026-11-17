import { START_HP } from "./rubric";
import type { HpState } from "./score";
import type { Case, EventOf, Lawyer, Penalty, Phase, TrialEvent } from "./types";

export type CourtState = {
  case?: Case;
  first?: Lawyer;
  hp: HpState;
  turns: { lawyer: Lawyer; phase: Phase; text: string; penalties: Penalty[] }[];
  current?: number;
  objections: EventOf<"objection">[];
  knockout?: Lawyer;
  verdict?: EventOf<"verdict">;
  error?: string;
};

export function initialState(): CourtState {
  return { hp: { AEGIS: START_HP, NEMESIS: START_HP }, turns: [], objections: [] };
}

const updateTurn = (s: CourtState, i: number, patch: (t: CourtState["turns"][number]) => Partial<CourtState["turns"][number]>) => ({
  ...s,
  turns: s.turns.map((t, j) => (j === i ? { ...t, ...patch(t) } : t)),
});

/** Pure fold step: the same function drives the live UI, demo playback and replay. */
export function reduceEvent(s: CourtState, e: TrialEvent): CourtState {
  switch (e.type) {
    case "filed":
      return { ...s, case: e.case, first: e.first };
    case "turn_start":
      return { ...s, current: e.turn, turns: [...s.turns, { lawyer: e.lawyer, phase: e.phase, text: "", penalties: [] }] };
    case "speech_delta":
      return updateTurn(s, e.turn, (t) => ({ text: t.text + e.text }));
    case "turn_end":
      return updateTurn(s, e.turn, () => ({ text: e.text }));
    case "objection":
      return { ...s, objections: [...s.objections, e] };
    case "ruling":
      return updateTurn(s, e.turn, () => ({ penalties: e.penalties }));
    case "hp_change":
      return { ...s, hp: { ...s.hp, [e.lawyer]: e.hp } };
    case "knockout":
      return { ...s, knockout: s.knockout ?? e.lawyer };
    case "verdict":
      return { ...s, verdict: e };
    case "error":
      return { ...s, error: e.message };
  }
}

export function reduceEvents(events: TrialEvent[]): CourtState {
  return events.reduce(reduceEvent, initialState());
}
