"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createAnthropicClient } from "@/lib/engine/anthropic";
import { CaseError, MAX_CONTEXT, MAX_IDEA, validateCase } from "@/lib/engine/case";
import { createOpenAICompatibleClient } from "@/lib/engine/openai-compatible";
import { GEMINI_BASE_URL, GEMINI_DEFAULT_MODEL } from "@/lib/engine/providers";
import { reduceEvents } from "@/lib/engine/reduce";
import { GROUNDS, RUBRIC, START_HP } from "@/lib/engine/rubric";
import { runTrial } from "@/lib/engine/trial";
import type { EventOf, Lawyer, Phase, TrialEvent } from "@/lib/engine/types";
import { playbackSteps, unblind } from "@/lib/web/playback";

const RECORDED = [
  { id: "startup", title: "Should I quit my job to build a startup?", note: "8 months of savings and a working prototype" },
  { id: "rust", title: "Should I learn Rust?", note: "No extra context" },
];

const PHASE: Record<Phase, string> = { opening: "Opening statement", rebuttal: "Rebuttal", closing: "Closing argument" };
const RULING: Record<"FOR" | "AGAINST" | "CONDITIONAL", { word: string; line: string }> = {
  FOR: { word: "For", line: "The court rules in favour of the idea." },
  AGAINST: { word: "Against", line: "The court rules against the idea." },
  CONDITIONAL: { word: "Conditional", line: "Go ahead only if the conditions below hold." },
};
const SPEEDS = [1, 2, 4];

type Provider = "anthropic" | "gemini";
type Mode = { kind: "idle" } | { kind: "recorded"; id: string } | { kind: "live" };
type Flash = { key: number; text: string; sub?: string; tone: "objection" | "sustained" | "overruled" };
type Pop = { key: number; lawyer: Lawyer; text: string };

const store = {
  get: (k: string) => {
    try {
      return sessionStorage.getItem(k) ?? "";
    } catch {
      return "";
    }
  },
  set: (k: string, v: string) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {}
  },
};

function explainError(message: string) {
  if (/\b401\b|authentication|api[_ -]?key/i.test(message)) return "The trial stopped: the API key was rejected. Check that it is correct and try again.";
  if (/\b429\b|rate|quota/i.test(message)) return "The trial stopped: the provider's rate limit or quota was reached. Wait a minute, or check the key's credit, then try again.";
  if (/failed to fetch|network/i.test(message)) return "The trial stopped: the provider couldn't be reached. Check your connection and try again.";
  return `The trial stopped: ${message}`;
}

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

export function Courtroom() {
  const [events, setEvents] = useState<TrialEvent[]>([]);
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [flash, setFlash] = useState<Flash>();
  const [pops, setPops] = useState<Pop[]>([]);
  const [tab, setTab] = useState<"recorded" | "live">("recorded");

  const runId = useRef(0);
  const pausedRef = useRef(false);
  const speedRef = useRef(1);
  const skipRef = useRef(false);
  const keyCounter = useRef(0);
  const feedEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    pausedRef.current = paused;
    speedRef.current = speed;
  }, [paused, speed]);

  const state = useMemo(() => reduceEvents(events), [events]);
  const rulings = useMemo(() => events.filter((e): e is EventOf<"ruling"> => e.type === "ruling"), [events]);

  useEffect(() => {
    if (events.length === 0) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    feedEnd.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "end" });
  }, [events.length]);

  /** Side effects of an event that the court state doesn't hold: stamps and damage pops. */
  function react(e: TrialEvent) {
    const key = ++keyCounter.current;
    if (e.type === "objection") {
      setFlash({ key, text: "Objection!", sub: `${e.by}: ${titleCase(e.ground)}`, tone: "objection" });
    } else if (e.type === "ruling" && e.objection) {
      setFlash({ key, text: e.objection === "SUSTAINED" ? "Sustained" : "Overruled", tone: e.objection === "SUSTAINED" ? "sustained" : "overruled" });
    } else if (e.type === "hp_change") {
      setPops((p) => [...p, { key, lawyer: e.lawyer, text: `${e.delta} ${RUBRIC[e.code].label}` }]);
      setTimeout(() => setPops((p) => p.filter((x) => x.key !== key)), 2200);
    }
  }

  function reset(next: Mode) {
    runId.current++;
    skipRef.current = false;
    setEvents([]);
    setFlash(undefined);
    setPops([]);
    setPaused(false);
    setMode(next);
  }

  async function playRecorded(id: string) {
    reset({ kind: "recorded", id });
    const run = runId.current;
    setRunning(true);
    const log: TrialEvent[] = await fetch(`/trials/${id}.json`).then((r) => r.json());
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const step of playbackSteps(log)) {
      if (!skipRef.current) {
        let waited = 0;
        while (waited < step.delay / speedRef.current || pausedRef.current) {
          await new Promise((r) => setTimeout(r, 40));
          if (run !== runId.current) return;
          if (skipRef.current) break;
          if (!pausedRef.current) waited += 40;
        }
      }
      if (run !== runId.current) return;
      setEvents((ev) => [...ev, step.event]);
      if (!skipRef.current && !reduced) react(step.event);
    }
    setRunning(false);
  }

  async function runLive(input: { idea: string; context: string; provider: Provider; key: string; first: Lawyer | "random" }) {
    const c = validateCase(input);
    reset({ kind: "live" });
    const run = runId.current;
    setRunning(true);
    const client =
      input.provider === "anthropic"
        ? createAnthropicClient(input.key, { browser: true })
        : createOpenAICompatibleClient({ baseUrl: GEMINI_BASE_URL, apiKey: input.key, lawyerModel: GEMINI_DEFAULT_MODEL, judgeModel: GEMINI_DEFAULT_MODEL });
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for await (const e of runTrial(c, client, input.first === "random" ? {} : { first: input.first })) {
      if (run !== runId.current) return;
      setEvents((ev) => [...ev, e]);
      if (!reduced) react(e);
    }
    setRunning(false);
  }

  function stop() {
    runId.current++;
    setRunning(false);
  }

  const turnLabel = (turn: number) => `Turn ${turn + 1}`;
  const diff = state.hp.AEGIS - state.hp.NEMESIS;
  const tilt = Math.max(-14, Math.min(14, diff * -2.5));
  const knockedOut = state.knockout;

  return (
    <div className="court">
      <header className="topbar">
        <Link href="/" className="brand" onClick={() => reset({ kind: "idle" })}>
          <ScalesIcon />
          <span>Courtroom AI</span>
        </Link>
        <a className="ghost" href="https://github.com/KRISH-exe-29/ai-courtroom-debate">
          Source on GitHub
        </a>
      </header>

      <section className="hud" aria-label="Scoreboard">
        <Fighter lawyer="AEGIS" role="Defence" hp={state.hp.AEGIS} pops={pops} out={knockedOut === "AEGIS"} />
        <div className="judge" aria-label={`Scales tilt ${diff === 0 ? "level" : diff > 0 ? "toward AEGIS" : "toward NEMESIS"}`}>
          <svg viewBox="-60 -60 120 110" className="scales" aria-hidden>
            <line x1="0" y1="-44" x2="0" y2="36" />
            <line x1="-20" y1="36" x2="20" y2="36" />
            <g style={{ transform: `rotate(${tilt}deg)` }} className="beam">
              <line x1="-42" y1="-30" x2="42" y2="-30" />
              <path d="M-42 -30 L-54 4 M-42 -30 L-30 4 M42 -30 L30 4 M42 -30 L54 4" />
              <path d="M-58 4 Q-42 22 -26 4 Z M26 4 Q42 22 58 4 Z" className="pan" />
            </g>
            <circle cy="-48" r="5" className="pan" />
          </svg>
          <span className="judge-name">Arbiter</span>
        </div>
        <Fighter lawyer="NEMESIS" role="Prosecution" hp={state.hp.NEMESIS} pops={pops} out={knockedOut === "NEMESIS"} />
      </section>

      {flash && (
        <div key={flash.key} className={`stamp stamp-${flash.tone}`} role="status" onAnimationEnd={() => setFlash(undefined)}>
          <strong>{flash.text}</strong>
          {flash.sub && <span>{flash.sub}</span>}
        </div>
      )}

      <main className="main">
        {mode.kind === "idle" ? (
          <section className="intro">
            <h1>Put your idea on trial.</h1>
            <p className="lede">
              Two AI lawyers argue over your idea or decision. A judge who never learns their names docks points for every bluff,
              dodge and contradiction, then gives a ruling with conditions.
            </p>
            <div className="tabs" role="tablist" aria-label="Choose how to start">
              <button role="tab" aria-selected={tab === "recorded"} onClick={() => setTab("recorded")}>
                Watch a recorded trial
              </button>
              <button role="tab" aria-selected={tab === "live"} onClick={() => setTab("live")}>
                Run your own trial
              </button>
            </div>
            {tab === "recorded" ? (
              <ul className="cases">
                {RECORDED.map((r) => (
                  <li key={r.id}>
                    <button onClick={() => playRecorded(r.id)}>
                      <span className="case-title">{r.title}</span>
                      <span className="case-note">{r.note}</span>
                      <span className="case-go">Watch the trial</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <LiveForm onStart={runLive} />
            )}
          </section>
        ) : (
          <section className="record" aria-live="polite">
            <div className="docket">
              <div>
                <p className="docket-label">{mode.kind === "recorded" ? "Recorded trial" : "Live trial"}</p>
                <h1 className="docket-case">{state.case?.idea ?? "Filing the case…"}</h1>
                {state.case?.context && <p className="docket-context">{state.case.context}</p>}
              </div>
            </div>

            <ol className="turns">
              {state.turns.map((t, i) => {
                const objection = state.objections.find((o) => o.turn === i);
                const verdictOnObjection = rulings.find((r) => r.turn === i)?.objection;
                const isCurrent = running && state.current === i && !rulings.some((r) => r.turn === i);
                return (
                  <li key={i} className={`turn turn-${t.lawyer.toLowerCase()}`} aria-current={isCurrent ? "step" : undefined}>
                    <p className="turn-head">
                      <span className="turn-who">{t.lawyer}</span>
                      <span className="turn-phase">
                        {PHASE[t.phase]}, {turnLabel(i).toLowerCase()}
                      </span>
                    </p>
                    <p className="speech">
                      {t.text}
                      {isCurrent && <span className="caret" aria-hidden />}
                    </p>
                    {objection && (
                      <p className="objection">
                        <b>{objection.by} objects: {titleCase(objection.ground)}.</b> {GROUNDS[objection.ground]}{" "}
                        <q>{objection.quote}</q>
                        {verdictOnObjection && <em className={`obj-${verdictOnObjection.toLowerCase()}`}> {titleCase(verdictOnObjection)}.</em>}
                      </p>
                    )}
                    {t.penalties.map((p, j) => (
                      <div key={j} className="penalty">
                        <span className="penalty-pts">−{p.points}</span>
                        <div>
                          <p className="penalty-code">{RUBRIC[p.code].label}</p>
                          <p className="penalty-reason">{unblind(p.reason, state.first)}</p>
                          {p.quote && <q className="penalty-quote">{unblind(p.quote, state.first)}</q>}
                        </div>
                      </div>
                    ))}
                  </li>
                );
              })}
            </ol>

            {knockedOut && <p className="knockout">Knockout. {knockedOut} has no points left.</p>}

            {state.verdict && (
              <section className="verdict" aria-label="Verdict">
                <p className="verdict-label">Arbiter&rsquo;s ruling</p>
                <p className="verdict-word">{RULING[state.verdict.ruling].word}</p>
                <p className="verdict-line">
                  {RULING[state.verdict.ruling].line} Confidence {state.verdict.confidence}%.
                </p>
                <p className="verdict-summary">{unblind(state.verdict.summary, state.first)}</p>
                {state.verdict.conditions.length > 0 && (
                  <ul className="conditions">
                    {state.verdict.conditions.map((c) => (
                      <li key={c}>{unblind(c, state.first)}</li>
                    ))}
                  </ul>
                )}
                <p className="turning">Turning point: {turnLabel(state.verdict.turningPoint).toLowerCase()}.</p>
              </section>
            )}

            {state.error && (
              <p className="error" role="alert">
                {explainError(state.error)}
              </p>
            )}
            <div ref={feedEnd} className="feed-end" />
          </section>
        )}
      </main>

      {mode.kind !== "idle" && (
        <nav className="controls" aria-label="Trial controls">
          {mode.kind === "recorded" && running && (
            <>
              <button onClick={() => setPaused((p) => !p)}>{paused ? "Resume" : "Pause"}</button>
              <div className="speeds" role="group" aria-label="Playback speed">
                {SPEEDS.map((s) => (
                  <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                    {s}×
                  </button>
                ))}
              </div>
              <button onClick={() => (skipRef.current = true)}>Skip to verdict</button>
            </>
          )}
          {mode.kind === "live" && running && <button onClick={stop}>Stop trial</button>}
          <button className="primary" onClick={() => reset({ kind: "idle" })}>
            New trial
          </button>
        </nav>
      )}
    </div>
  );
}

function Fighter({ lawyer, role, hp, pops, out }: { lawyer: Lawyer; role: string; hp: number; pops: Pop[]; out: boolean }) {
  return (
    <div className={`fighter fighter-${lawyer.toLowerCase()}${out ? " is-out" : ""}`}>
      <div className="fighter-id">
        <span className="fighter-name">{lawyer}</span>
        <span className="fighter-role">{role}</span>
      </div>
      <div className="hp" role="meter" aria-label={`${lawyer} health`} aria-valuemin={0} aria-valuemax={START_HP} aria-valuenow={hp}>
        {Array.from({ length: START_HP }, (_, i) => (
          <span key={i} className={i < hp ? "seg on" : "seg"} />
        ))}
        <span className="hp-num">{hp}</span>
      </div>
      <div className="pops" aria-hidden>
        {pops
          .filter((p) => p.lawyer === lawyer)
          .map((p) => (
            <span key={p.key} className="pop">
              {p.text}
            </span>
          ))}
      </div>
    </div>
  );
}

function LiveForm({ onStart }: { onStart: (i: { idea: string; context: string; provider: Provider; key: string; first: Lawyer | "random" }) => void }) {
  const [idea, setIdea] = useState("");
  const [context, setContext] = useState("");
  const [provider, setProvider] = useState<Provider>(() => (store.get("court-provider") === "gemini" ? "gemini" : "anthropic"));
  const [key, setKey] = useState(() => store.get(`court-key-${store.get("court-provider") === "gemini" ? "gemini" : "anthropic"}`));
  const [first, setFirst] = useState<Lawyer | "random">("random");
  const [error, setError] = useState("");

  function switchProvider(p: Provider) {
    setProvider(p);
    setKey(store.get(`court-key-${p}`));
    store.set("court-provider", p);
  }

  return (
    <form
      className="live"
      onSubmit={(ev) => {
        ev.preventDefault();
        setError("");
        if (!key.trim()) return setError("Add an API key to run a live trial, or watch a recorded one.");
        try {
          store.set(`court-key-${provider}`, key.trim());
          onStart({ idea, context, provider, key: key.trim(), first });
        } catch (e) {
          setError(e instanceof CaseError ? e.message : String(e));
        }
      }}
    >
      <label>
        <span>Your idea or decision</span>
        <textarea required maxLength={MAX_IDEA} rows={2} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="Should I move to Berlin for a job offer?" />
      </label>
      <label>
        <span>Background the lawyers should know (optional)</span>
        <textarea maxLength={MAX_CONTEXT} rows={3} value={context} onChange={(e) => setContext(e.target.value)} placeholder="The offer pays 20% more. I don't speak German. My partner can work remotely." />
      </label>
      <div className="row">
        <label>
          <span>Model</span>
          <select value={provider} onChange={(e) => switchProvider(e.target.value as Provider)}>
            <option value="anthropic">Claude (Anthropic key)</option>
            <option value="gemini">Gemini (Google AI Studio key)</option>
          </select>
        </label>
        <label>
          <span>Who speaks first</span>
          <select value={first} onChange={(e) => setFirst(e.target.value as Lawyer | "random")}>
            <option value="random">Random</option>
            <option value="AEGIS">AEGIS, the defence</option>
            <option value="NEMESIS">NEMESIS, the prosecution</option>
          </select>
        </label>
      </div>
      <label>
        <span>API key</span>
        <input type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder={provider === "anthropic" ? "sk-ant-…" : "AIza…"} />
      </label>
      <p className="hint">
        Your key stays in this browser tab and is sent only to {provider === "anthropic" ? "Anthropic" : "Google"}. There is no server in between.
        {provider === "anthropic" && " A full trial costs about $0.20."}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="primary" type="submit">
        Start the trial
      </button>
    </form>
  );
}

function ScalesIcon() {
  return (
    <svg viewBox="-60 -60 120 110" width="28" height="26" aria-hidden className="brand-icon">
      <line x1="0" y1="-44" x2="0" y2="36" />
      <line x1="-20" y1="36" x2="20" y2="36" />
      <line x1="-42" y1="-30" x2="42" y2="-30" />
      <path d="M-42 -30 L-54 4 M-42 -30 L-30 4 M42 -30 L30 4 M42 -30 L54 4" />
      <path d="M-58 4 Q-42 22 -26 4 Z M26 4 Q42 22 58 4 Z" className="pan" />
    </svg>
  );
}
