export type Lawyer = "AEGIS" | "NEMESIS";
export type Side = "A" | "B";
export type Phase = "opening" | "rebuttal" | "closing";
export type OffenceCode = "UNSUPPORTED" | "REPETITION" | "EVASION" | "FALLACY" | "CONTRADICTION" | "SUSTAINED";
export type ObjectionGround = "RELEVANCE" | "SPECULATION" | "MISCHARACTERIZATION" | "ASKED_AND_ANSWERED" | "ASSUMES_FACTS";
export type Ruling = "FOR" | "AGAINST" | "CONDITIONAL";

export type Penalty = { code: OffenceCode; points: number; reason: string; quote: string; evidence?: string };
export type Case = { idea: string; context: string };

/** One entry in a trial's event log. `at` is milliseconds since the trial started. */
export type TrialEvent = { at: number } & (
  | { type: "filed"; case: Case; first: Lawyer }
  | { type: "turn_start"; turn: number; lawyer: Lawyer; phase: Phase }
  | { type: "speech_delta"; turn: number; text: string }
  | { type: "turn_end"; turn: number; text: string }
  | { type: "objection"; turn: number; by: Lawyer; ground: ObjectionGround; quote: string }
  | {
      type: "ruling";
      turn: number;
      penalties: Penalty[];
      dropped: number;
      objection?: "SUSTAINED" | "OVERRULED";
      skipped?: true;
    }
  | { type: "hp_change"; lawyer: Lawyer; delta: number; hp: number; reason: string; code: OffenceCode; turn: number }
  | { type: "knockout"; lawyer: Lawyer }
  | { type: "verdict"; ruling: Ruling; conditions: string[]; confidence: number; summary: string; turningPoint: number }
  | { type: "error"; message: string }
);

export type EventOf<T extends TrialEvent["type"]> = Extract<TrialEvent, { type: T }>;
