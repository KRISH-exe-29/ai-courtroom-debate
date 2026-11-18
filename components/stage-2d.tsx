import type { CourtState } from "@/lib/engine/reduce";
import type { Lawyer } from "@/lib/engine/types";

/** Where each figure stands on the 1600×900 stage: its box, and the point between its feet. */
const FIG: Record<Lawyer, { src: string; x: number; y: number; w: number; h: number; feet: number }> = {
  AEGIS: { src: "/stage/aegis.webp", x: 150, y: 320, w: 291, h: 560, feet: 280 },
  NEMESIS: { src: "/stage/nemesis.webp", x: 960, y: 341, w: 607, h: 539, feet: 1336 },
};
const FLOOR = 878;
/** The top edge of the bench in the court picture; the judge is cut off there. */
const BENCH_TOP = 385;

/**
 * The flat courtroom, for phones and browsers without 3D. A painted court with the three figures
 * layered over it. The camera pushes in on whoever is speaking, and on the judge for the verdict.
 */
export function Stage2D({ state, hits }: { state: CourtState; hits: Lawyer[] }) {
  const speaker = state.current !== undefined && !state.verdict ? state.turns[state.current]?.lawyer : undefined;
  const focus = state.verdict ? "judge" : (speaker?.toLowerCase() ?? "wide");

  return (
    <svg className={`stage2d focus-${focus}`} viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <clipPath id="s2-bench">
          <rect width="1600" height={BENCH_TOP} />
        </clipPath>
        {(["aegis", "nemesis"] as const).map((k) => (
          <radialGradient key={k} id={`s2-pool-${k}`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor={`var(--${k})`} stopOpacity="0.75" />
            <stop offset="1" stopColor={`var(--${k})`} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>

      <g className="cam">
        <image className="s2-plate" href="/stage/court.webp" width="1600" height="900" preserveAspectRatio="xMidYMid slice" />

        <g className="arbiter" clipPath="url(#s2-bench)">
          <image href="/stage/arbiter.webp" x="648" y="150" width="304" height="249" />
        </g>
        <g className={state.verdict ? "gavel strike" : "gavel"}>
          <rect x="900" y="365" width="56" height="7" rx="3" fill="#6b4a2e" />
          <rect x="890" y="351" width="24" height="34" rx="5" fill="#4a3020" />
        </g>

        <Figure who="NEMESIS" speaking={speaker === "NEMESIS"} hit={hits.includes("NEMESIS")} out={state.knockout === "NEMESIS"} />
        <Figure who="AEGIS" speaking={speaker === "AEGIS"} hit={hits.includes("AEGIS")} out={state.knockout === "AEGIS"} />
      </g>
    </svg>
  );
}

function Figure({ who, speaking, hit, out }: { who: Lawyer; speaking: boolean; hit: boolean; out: boolean }) {
  const f = FIG[who];
  const key = who.toLowerCase();
  const cls = ["fig", `fig-${key}`, speaking && "speaking", hit && "hit", out && "out"].filter(Boolean).join(" ");
  return (
    <g className={cls} style={{ transformOrigin: `${f.feet}px ${FLOOR}px` }}>
      <ellipse className="pool" cx={f.feet} cy={FLOOR} rx="230" ry="38" fill={`url(#s2-pool-${key})`} />
      <g className="fig-body">
        <image href={f.src} x={f.x} y={f.y} width={f.w} height={f.h} />
      </g>
    </g>
  );
}
