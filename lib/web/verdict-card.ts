import type { CourtState } from "../engine/reduce";
import type { Lawyer, Ruling } from "../engine/types";
import { unblind } from "./playback";

export const CARD_W = 1200;
export const CARD_H = 630;
const SITE = "ai-courtroom-debate.vercel.app";

export type CardData = {
  idea: string;
  ruling: Ruling;
  confidence: number;
  hp: Record<Lawyer, number>;
  quote?: { text: string; by: Lawyer; turn: number };
};

const RULING_WORD: Record<Ruling, string> = { FOR: "For", AGAINST: "Against", CONDITIONAL: "Conditional" };

/**
 * What the card shows. The quote is the line that decided the turning point: the first penalty
 * quote from that turn, else the opening sentence of its speech.
 */
export function cardData(s: CourtState): CardData | undefined {
  if (!s.case || !s.verdict) return undefined;
  const turn = s.turns[s.verdict.turningPoint];
  let quote: CardData["quote"];
  if (turn) {
    const text = turn.penalties.find((p) => p.quote)?.quote ?? turn.text.split(/(?<=[.!?])\s/)[0];
    if (text?.trim()) quote = { text: unblind(text.trim(), s.first), by: turn.lawyer, turn: s.verdict.turningPoint + 1 };
  }
  return { idea: s.case.idea, ruling: s.verdict.ruling, confidence: s.verdict.confidence, hp: s.hp, quote };
}

/** Greedy word wrap; the last line ends in "…" when the text doesn't fit in maxLines. */
export function wrapText(measure: (s: string) => number, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  let i = 0;
  for (; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (measure(next) <= maxWidth || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = words[i];
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines) {
    lines.push(line);
    return lines;
  }
  let last = lines[maxLines - 1];
  while (last && measure(`${last}…`) > maxWidth) last = last.slice(0, last.lastIndexOf(" ") > 0 ? last.lastIndexOf(" ") : -1);
  lines[maxLines - 1] = `${last.replace(/[\s,.;:]+$/, "")}…`;
  return lines;
}

const COLORS = { night: "#0c1020", bench: "#141a2e", paper: "#e9ecf5", muted: "#9aa3bd", aegis: "#4c8dff", nemesis: "#ff5a5a", gold: "#f2c14e", empty: "#ffffff1f" };

const cssFont = (name: string, fallback: string) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

function scales(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.strokeStyle = COLORS.gold;
  ctx.fillStyle = COLORS.gold;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, -40);
  ctx.lineTo(0, 36);
  ctx.moveTo(-20, 36);
  ctx.lineTo(20, 36);
  ctx.moveTo(-40, -28);
  ctx.lineTo(40, -28);
  ctx.moveTo(-40, -28);
  ctx.lineTo(-50, 4);
  ctx.moveTo(-40, -28);
  ctx.lineTo(-30, 4);
  ctx.moveTo(40, -28);
  ctx.lineTo(30, 4);
  ctx.moveTo(40, -28);
  ctx.lineTo(50, 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-54, 4);
  ctx.quadraticCurveTo(-40, 20, -26, 4);
  ctx.moveTo(26, 4);
  ctx.quadraticCurveTo(40, 20, 54, 4);
  ctx.fill();
  ctx.restore();
}

function hpBar(ctx: CanvasRenderingContext2D, x: number, y: number, hp: number, color: string, rightToLeft: boolean) {
  const seg = 30;
  const gap = 6;
  for (let i = 0; i < 10; i++) {
    const on = rightToLeft ? 9 - i < hp : i < hp;
    ctx.fillStyle = on ? color : COLORS.empty;
    ctx.save();
    ctx.translate(x + i * (seg + gap), y);
    ctx.transform(1, 0, rightToLeft ? 0.3 : -0.3, 1, 0, 0);
    ctx.beginPath();
    ctx.roundRect(0, 0, seg, 16, 3);
    ctx.fill();
    ctx.restore();
  }
}

/** Draws the 1200×630 verdict card. Waits for the site's fonts so the card matches the page. */
export async function drawVerdictCard(canvas: HTMLCanvasElement, d: CardData) {
  const display = cssFont("--font-display", "Arial Narrow, sans-serif");
  const serif = cssFont("--font-serif", "Georgia, serif");
  await Promise.all([document.fonts.load(`800 120px ${display}`), document.fonts.load(`italic 30px ${serif}`), document.fonts.load(`600 30px ${display}`)]);

  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = COLORS.night;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const glow = ctx.createRadialGradient(CARD_W - 250, 210, 10, CARD_W - 250, 210, 520);
  glow.addColorStop(0, "#f2c14e22");
  glow.addColorStop(1, "#f2c14e00");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const L = 64;
  ctx.textBaseline = "alphabetic";

  // Header
  scales(ctx, L + 22, 58, 0.42);
  ctx.fillStyle = COLORS.paper;
  ctx.font = `700 32px ${display}`;
  ctx.fillText("Courtroom AI", L + 56, 70);
  ctx.fillStyle = COLORS.muted;
  ctx.font = `500 26px ${display}`;
  ctx.textAlign = "right";
  ctx.fillText(SITE, CARD_W - L, 70);
  ctx.textAlign = "left";

  // The idea on trial
  ctx.fillStyle = COLORS.paper;
  ctx.font = `700 50px ${display}`;
  const ideaLines = wrapText((s) => ctx.measureText(s).width, d.idea, CARD_W - 2 * L, 2);
  ideaLines.forEach((line, i) => ctx.fillText(line, L, 150 + i * 54));
  let y = 150 + (ideaLines.length - 1) * 54;

  // The ruling
  y += 150;
  ctx.fillStyle = COLORS.gold;
  ctx.font = `800 128px ${display}`;
  const word = RULING_WORD[d.ruling];
  ctx.fillText(word, L - 4, y);
  const wordW = ctx.measureText(word).width;
  ctx.fillStyle = COLORS.muted;
  ctx.font = `600 30px ${display}`;
  ctx.fillText("Arbiter’s ruling", L + wordW + 28, y - 62);
  ctx.fillStyle = COLORS.paper;
  ctx.fillText(`${Math.round(d.confidence)}% confidence`, L + wordW + 28, y - 22);

  // Turning-point quote
  if (d.quote) {
    y += 78;
    ctx.fillStyle = COLORS.gold;
    ctx.fillRect(L, y - 26, 4, 70);
    ctx.fillStyle = "#c9cfe0";
    ctx.font = `italic 28px ${serif}`;
    const q = wrapText((s) => ctx.measureText(s).width, `“${d.quote.text}”`, CARD_W - 2 * L - 24, 2);
    q.forEach((line, i) => ctx.fillText(line, L + 22, y + i * 36));
    ctx.fillStyle = COLORS.muted;
    ctx.font = `500 22px ${display}`;
    ctx.fillText(`${d.quote.by}, turn ${d.quote.turn}: the turning point`, L + 22, y + q.length * 36 + 4);
  }

  // Final HP
  const barY = CARD_H - 58;
  ctx.font = `800 34px ${display}`;
  ctx.fillStyle = COLORS.aegis;
  ctx.fillText("AEGIS", L, barY - 14);
  hpBar(ctx, L, barY, d.hp.AEGIS, COLORS.aegis, false);
  ctx.fillStyle = COLORS.paper;
  ctx.font = `700 30px ${display}`;
  ctx.fillText(String(d.hp.AEGIS), L + 370, barY + 15);

  ctx.textAlign = "right";
  ctx.font = `800 34px ${display}`;
  ctx.fillStyle = COLORS.nemesis;
  ctx.fillText("NEMESIS", CARD_W - L, barY - 14);
  hpBar(ctx, CARD_W - L - 354, barY, d.hp.NEMESIS, COLORS.nemesis, true);
  ctx.fillStyle = COLORS.paper;
  ctx.font = `700 30px ${display}`;
  ctx.fillText(String(d.hp.NEMESIS), CARD_W - L - 370, barY + 15);
  ctx.textAlign = "left";
}
