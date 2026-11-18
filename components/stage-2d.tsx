import type { CourtState } from "@/lib/engine/reduce";
import type { Lawyer } from "@/lib/engine/types";

/** Where each figure stands on the 1600×900 stage. */
const AT: Record<Lawyer, number> = { AEGIS: 420, NEMESIS: 1180 };
const FEET = 700;

/**
 * The flat courtroom, for phones and browsers without 3D. Same staging as the 3D court: a camera
 * that pushes in on whoever is speaking, a spotlight on them, and a rail in the foreground that
 * moves less than the room behind it, so the shot keeps its depth.
 */
export function Stage2D({ state, hits }: { state: CourtState; hits: Lawyer[] }) {
  const speaker = state.current !== undefined && !state.verdict ? state.turns[state.current]?.lawyer : undefined;
  const focus = state.verdict ? "judge" : (speaker?.toLowerCase() ?? "wide");
  const tilt = Math.max(-14, Math.min(14, (state.hp.AEGIS - state.hp.NEMESIS) * -2.5));

  return (
    <svg className={`stage2d focus-${focus}`} viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id="s2-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#070a16" />
          <stop offset="1" stopColor="#151c36" />
        </linearGradient>
        <linearGradient id="s2-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b2342" />
          <stop offset="1" stopColor="#090c18" />
        </linearGradient>
        {(["aegis", "nemesis", "gold"] as const).map((k) => (
          <linearGradient key={k} id={`s2-cone-${k}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={`var(--${k})`} stopOpacity="0.55" />
            <stop offset="1" stopColor={`var(--${k})`} stopOpacity="0" />
          </linearGradient>
        ))}
        <radialGradient id="s2-pool" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <filter id="s2-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="8" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g className="cam">
        <rect width="1600" height="540" fill="url(#s2-wall)" />
        {[300, 450, 1150, 1300].map((x) => (
          <g key={x}>
            <rect x={x - 26} y="40" width="52" height="480" fill="#1d2647" />
            <rect x={x - 26} y="40" width="14" height="480" fill="#2a3560" />
          </g>
        ))}
        <circle cx="800" cy="160" r="70" fill="#121933" />
        <circle cx="800" cy="160" r="74" fill="none" stroke="var(--gold)" strokeWidth="7" filter="url(#s2-glow)" />

        <polygon points="0,540 1600,540 1600,900 0,900" fill="url(#s2-floor)" />
        {[-600, -300, 0, 300, 600].map((dx) => (
          <line key={dx} x1={800 + dx * 0.35} y1="540" x2={800 + dx * 2.2} y2="900" stroke="#ffffff08" strokeWidth="2" />
        ))}
        <polygon points="740,540 860,540 980,900 620,900" fill="#2a1830" opacity="0.8" />

        {/* light shafts: bright on the speaker, faint on the other side */}
        {(["AEGIS", "NEMESIS"] as const).map((l) => (
          <g key={l} className={`shaft${speaker === l ? " on" : ""}`}>
            <polygon points={`${AT[l] - 24},0 ${AT[l] + 24},0 ${AT[l] + 170},${FEET + 10} ${AT[l] - 170},${FEET + 10}`} fill={`url(#s2-cone-${l.toLowerCase()})`} />
            <ellipse cx={AT[l]} cy={FEET + 6} rx="170" ry="34" fill="url(#s2-pool)" />
          </g>
        ))}
        <g className={`shaft${state.verdict ? " on" : ""}`}>
          <polygon points="770,0 830,0 1000,560 600,560" fill="url(#s2-cone-gold)" />
        </g>

        {/* the bench and the blindfolded judge */}
        <rect x="560" y="470" width="480" height="70" fill="#202a4e" />
        <polygon points="776,300 824,300 852,470 748,470" fill="#1b2340" />
        <polygon points="800,232 830,250 830,284 800,302 770,284 770,250" fill="#c9b8a3" />
        <rect x="766" y="258" width="68" height="12" rx="3" fill="var(--gold)" />
        <rect x="610" y="380" width="380" height="96" fill="#2d3860" />
        <rect x="600" y="372" width="400" height="12" fill="var(--gold)" opacity="0.9" />
        <g transform="translate(680 372)" stroke="var(--gold)" strokeWidth="4" strokeLinecap="round" fill="none">
          <line x1="0" y1="0" x2="0" y2="-74" />
          <g style={{ transform: `rotate(${tilt}deg)`, transformOrigin: "0px -70px" }} className="s2-beam">
            <line x1="-44" y1="-70" x2="44" y2="-70" />
            <path d="M-44 -70 L-44 -40 M44 -70 L44 -40" strokeWidth="2" />
            <path d="M-60 -40 Q-44 -24 -28 -40 Z M28 -40 Q44 -24 60 -40 Z" fill="var(--gold)" stroke="none" />
          </g>
        </g>
        <g className={state.verdict ? "gavel strike" : "gavel"}>
          <rect x="880" y="352" width="56" height="7" rx="3" fill="#6b4a2e" />
          <rect x="870" y="338" width="24" height="34" rx="5" fill="#4a3020" />
        </g>

        <Figure who="AEGIS" hp={state.hp.AEGIS} speaking={speaker === "AEGIS"} hit={hits.includes("AEGIS")} out={state.knockout === "AEGIS"} />
        <Figure who="NEMESIS" hp={state.hp.NEMESIS} speaking={speaker === "NEMESIS"} hit={hits.includes("NEMESIS")} out={state.knockout === "NEMESIS"} />
      </g>

      {/* foreground rail: on its own layer so it drifts against the room */}
      <g className="fg">
        <rect x="-200" y="842" width="2000" height="22" fill="#05070f" />
        {Array.from({ length: 26 }, (_, i) => (
          <rect key={i} x={-180 + i * 76} y="864" width="16" height="60" fill="#05070f" />
        ))}
      </g>
    </svg>
  );
}

function Figure({ who, hp, speaking, hit, out }: { who: Lawyer; hp: number; speaking: boolean; hit: boolean; out: boolean }) {
  const x = AT[who];
  const color = who === "AEGIS" ? "var(--aegis)" : "var(--nemesis)";
  const cls = ["fig", `fig-${who.toLowerCase()}`, speaking && "speaking", hit && "hit", out && "out"].filter(Boolean).join(" ");
  return (
    <g className={cls} style={{ transformOrigin: `${x}px ${FEET}px` }}>
      <g className="fig-body">
        {who === "AEGIS" ? (
          <>
            <polygon points={`${x - 34},500 ${x + 34},500 ${x + 54},${FEET} ${x - 54},${FEET}`} fill={color} />
            <polygon points={`${x - 34},500 ${x - 6},500 ${x - 14},${FEET} ${x - 54},${FEET}`} fill="#ffffff22" />
            <polygon points={`${x},430 ${x + 30},447 ${x + 30},481 ${x},498 ${x - 30},481 ${x - 30},447`} fill="#dfe6ff" />
            <polygon points={`${x + 58},540 ${x + 98},562 ${x + 98},606 ${x + 58},628 ${x + 18},606 ${x + 18},562`} fill="#20335e" stroke={color} strokeWidth="6" />
          </>
        ) : (
          <>
            <polygon points={`${x - 52},500 ${x + 52},500 ${x + 26},${FEET} ${x - 26},${FEET}`} fill={color} />
            <polygon points={`${x + 52},500 ${x + 14},500 ${x + 6},${FEET} ${x + 26},${FEET}`} fill="#00000033" />
            <polygon points={`${x},422 ${x + 32},462 ${x},500 ${x - 32},462`} fill="#ffd9d9" />
            <polygon points={`${x - 52},500 ${x - 92},470 ${x - 60},530`} fill={color} />
            <polygon points={`${x + 52},500 ${x + 92},470 ${x + 60},530`} fill={color} />
          </>
        )}
      </g>
      <rect x={x - 90} y="606" width="180" height="120" rx="4" fill="#1e2747" />
      <rect x={x - 90} y="606" width="180" height="10" fill="#2a3560" />
      {Array.from({ length: 10 }, (_, i) => (
        <rect key={i} x={x - 74 + i * 15} y="650" width="10" height="22" rx="2" fill={i < hp ? color : "#141a2e"} className={i < hp ? "seg-on" : undefined} />
      ))}
    </g>
  );
}
