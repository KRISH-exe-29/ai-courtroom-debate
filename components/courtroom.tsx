"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createAnthropicClient } from "@/lib/engine/anthropic";
import { CaseError, MAX_CONTEXT, MAX_IDEA, validateCase } from "@/lib/engine/case";
import { createOpenAICompatibleClient } from "@/lib/engine/openai-compatible";
import { GEMINI_BASE_URL, GEMINI_DEFAULT_MODEL } from "@/lib/engine/providers";
import { reduceEvents, type CourtState } from "@/lib/engine/reduce";
import { GROUNDS, RUBRIC, START_HP } from "@/lib/engine/rubric";
import { runTrial } from "@/lib/engine/trial";
import type { EventOf, Lawyer, Phase, TrialEvent } from "@/lib/engine/types";
import { playbackSteps, timelineMarkers, unblind } from "@/lib/web/playback";
import { MAX_FILE_BYTES, parseTrialFile, toTrialFile, TrialFileError, trialFileName } from "@/lib/web/trial-file";
import { cardData, drawVerdictCard } from "@/lib/web/verdict-card";

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
type Mode = { kind: "idle" } | { kind: "recorded"; id: string } | { kind: "file"; name: string } | { kind: "live" };
const DOCKET: Record<Exclude<Mode["kind"], "idle">, string> = { recorded: "Recorded trial", file: "Opened from a saved trial", live: "Live trial" };
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
  /** How many events the rewind bar shows; undefined means all of them. */
  const [pos, setPos] = useState<number>();
  const [fileError, setFileError] = useState("");

  const runId = useRef(0);
  /** The trial as it will be saved: the original log, not the word-by-word playback chunks. */
  const sourceLog = useRef<TrialEvent[]>([]);
  const pausedRef = useRef(false);
  const speedRef = useRef(1);
  const skipRef = useRef(false);
  const keyCounter = useRef(0);
  const feedEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    pausedRef.current = paused;
    speedRef.current = speed;
  }, [paused, speed]);

  const shown = useMemo(() => (pos === undefined ? events : events.slice(0, pos)), [events, pos]);
  const state = useMemo(() => reduceEvents(shown), [shown]);
  const rulings = useMemo(() => shown.filter((e): e is EventOf<"ruling"> => e.type === "ruling"), [shown]);
  const markers = useMemo(() => (running ? [] : timelineMarkers(events)), [events, running]);

  useEffect(() => {
    if (shown.length === 0) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    feedEnd.current?.scrollIntoView({ behavior: reduced || pos !== undefined ? "auto" : "smooth", block: "end" });
  }, [shown.length, pos]);

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
    setPos(undefined);
    setFileError("");
    sourceLog.current = [];
    setMode(next);
  }

  async function playRecorded(id: string) {
    reset({ kind: "recorded", id });
    const run = runId.current;
    setRunning(true);
    const log: TrialEvent[] = await fetch(`/trials/${id}.json`).then((r) => r.json());
    if (run === runId.current) await playLog(log, run);
  }

  async function openFile(file: File) {
    setFileError("");
    try {
      if (file.size > MAX_FILE_BYTES) throw new TrialFileError("That file is too large to be a saved trial.");
      const log = parseTrialFile(await file.text());
      reset({ kind: "file", name: file.name });
      setRunning(true);
      await playLog(log, runId.current);
    } catch (e) {
      setFileError(e instanceof TrialFileError ? e.message : "That file couldn't be read.");
    }
  }

  function saveTrial() {
    const log = sourceLog.current.length ? sourceLog.current : events;
    const url = URL.createObjectURL(new Blob([toTrialFile(log)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = trialFileName(state.case?.idea ?? "trial");
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function playLog(log: TrialEvent[], run: number) {
    sourceLog.current = log;
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
      sourceLog.current = [...sourceLog.current, e];
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
            <div className="open-file">
              <label className="file-button">
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) openFile(file);
                  }}
                />
                Open a saved trial
              </label>
              <span className="hint">Replays a trial file saved from this site or the terminal courtroom.</span>
              {fileError && (
                <p className="error" role="alert">
                  {fileError}
                </p>
              )}
            </div>
          </section>
        ) : (
          <section className="record" aria-live="polite">
            <div className="docket">
              <div>
                <p className="docket-label">{DOCKET[mode.kind]}</p>
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

            {state.verdict && !running && <VerdictCard state={state} />}

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
        <nav className={`controls${!running && events.length > 0 ? " has-timeline" : ""}`} aria-label="Trial controls">
          {!running && events.length > 0 && (
            <Timeline
              length={events.length}
              value={pos ?? events.length}
              markers={markers}
              turn={state.current}
              onChange={(v) => setPos(v >= events.length ? undefined : v)}
            />
          )}
          {mode.kind !== "live" && running && (
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
          <div className="control-row">
            {!running && events.length > 0 && <button onClick={saveTrial}>Save trial</button>}
            <button className="primary" onClick={() => reset({ kind: "idle" })}>
              New trial
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}

/** The shareable verdict card: a 1200×630 image drawn in the browser, with download, copy and share. */
function VerdictCard({ state }: { state: CourtState }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("");
  const [canShare, setCanShare] = useState(false);
  const data = useMemo(() => cardData(state), [state]);

  useEffect(() => {
    if (!data || !canvas.current) return;
    let live = true;
    drawVerdictCard(canvas.current, data).then(() => {
      if (!live) return;
      try {
        const probe = new File([""], "card.png", { type: "image/png" });
        setCanShare(!!navigator.canShare?.({ files: [probe] }));
      } catch {
        setCanShare(false);
      }
    });
    return () => {
      live = false;
    };
  }, [data]);

  if (!data) return null;
  const name = trialFileName(data.idea).replace("courtroom-trial-", "courtroom-verdict-").replace(/\.json$/, ".png");
  const blob = () => new Promise<Blob>((resolve, reject) => canvas.current?.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/png"));

  async function download() {
    const url = URL.createObjectURL(await blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Image downloaded.");
  }

  async function copy() {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob() })]);
      setStatus("Image copied. Paste it anywhere.");
    } catch {
      setStatus("This browser can't copy images. Use Download image instead.");
    }
  }

  async function share() {
    try {
      const file = new File([await blob()], name, { type: "image/png" });
      await navigator.share({ files: [file], title: "Courtroom AI verdict", text: `The court's ruling on "${data!.idea}"` });
      setStatus("");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setStatus("Sharing didn't work here. Use Download image instead.");
    }
  }

  return (
    <section className="card" aria-label="Verdict card">
      <p className="verdict-label">Share the verdict</p>
      <canvas ref={canvas} className="card-image" role="img" aria-label={`Verdict card: ${data.idea}, ruled ${data.ruling.toLowerCase()}`} />
      <div className="card-actions">
        <button className="primary" onClick={download}>
          Download image
        </button>
        <button className="ghost-button" onClick={copy}>
          Copy image
        </button>
        {canShare && (
          <button className="ghost-button" onClick={share}>
            Share
          </button>
        )}
        <span className="hint" role="status">
          {status}
        </span>
      </div>
    </section>
  );
}

/** The rewind bar: drag to any moment of a finished trial; markers jump to the notable ones. */
function Timeline({
  length,
  value,
  markers,
  turn,
  onChange,
}: {
  length: number;
  value: number;
  markers: { index: number; kind: string; label: string }[];
  turn?: number;
  onChange: (v: number) => void;
}) {
  // Markers closer than MIN_GAP% would cover each other, so later ones drop to a lower row.
  const MIN_GAP = 2.5;
  const lastInRow: number[] = [];
  const items = markers.map((m) => {
    const left = ((m.index - 1) / Math.max(1, length - 1)) * 100;
    let row = lastInRow.findIndex((l) => left - l >= MIN_GAP);
    if (row === -1) row = lastInRow.length;
    lastInRow[row] = left;
    return { ...m, left, row };
  });
  const placed = { items, rows: Math.max(1, lastInRow.length) };

  return (
    <div className="timeline">
      <input
        type="range"
        min={1}
        max={length}
        value={value}
        aria-label="Rewind the trial"
        aria-valuetext={value >= length ? "End of the trial" : `Turn ${(turn ?? 0) + 1}`}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="markers" style={{ height: `${placed.rows * 14}px` }}>
        {placed.items.map((m) => (
          <button
            key={`${m.kind}-${m.index}`}
            className={`marker marker-${m.kind}`}
            style={{ left: `${m.left}%`, top: `${m.row * 14}px` }}
            title={m.label}
            aria-label={`Jump to: ${m.label}`}
            onClick={() => onChange(m.index)}
          />
        ))}
      </div>
      <div className="legend" aria-hidden>
        <span className="key key-penalty">HP lost</span>
        <span className="key key-objection">Objection</span>
        <span className="key key-turning">Turning point</span>
        <span className="key key-verdict">Verdict</span>
      </div>
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
