import type { MarkState } from "./assign";

/**
 * 自己的片段库：每个片段只驱动一个演员，组合时不会互相覆盖 transform。
 * 循环片段 10 个 + 命令式 oneshot 3 个（spin / bounce / burst）。
 */
export type BodyClip = "breathe" | "breatheFast" | "breatheSlow" | "sway" | "swaySlow" | "nod" | "shiver";
export type EyesClip = "blink";
export type LookClip = "glance" | "glanceFast" | "droop";
export type OrbitClip = "orbitSlow" | "orbitFast";
export type BitsClip = "bitsSoft" | "bitsOn";
export type PulseClip = "pulse";

export interface ClipRecipe {
  body?: BodyClip;
  eyes?: EyesClip;
  look?: LookClip;
  orbit?: OrbitClip;
  bits?: BitsClip;
  pulse?: PulseClip;
}

export const STATE_CLIPS: Record<MarkState, ClipRecipe> = {
  idle: { body: "breathe", eyes: "blink", look: "glance" },
  listening: { body: "breathe", eyes: "blink" },
  thinking: { body: "sway", eyes: "blink", look: "droop", orbit: "orbitSlow", bits: "bitsSoft" },
  searching: { body: "nod", eyes: "blink", look: "glanceFast", orbit: "orbitFast", pulse: "pulse" },
  working: { body: "breatheFast", eyes: "blink", look: "glanceFast", orbit: "orbitFast", bits: "bitsOn" },
  sleeping: { body: "breatheSlow", look: "droop" },
  spawning: { body: "breatheFast", orbit: "orbitFast", bits: "bitsOn", pulse: "pulse" },
  celebrate: { body: "nod", eyes: "blink", look: "glanceFast", bits: "bitsOn", pulse: "pulse" },
  confused: { body: "shiver", eyes: "blink", look: "glanceFast" },
  sad: { body: "swaySlow", look: "droop" },
};

export const BOUNCE_PRESETS = [
  { h: 6, d: 0.177 },
  { h: 14, d: 0.27 },
  { h: 28, d: 0.382 },
  { h: 48, d: 0.5 },
] as const;

export type BounceLevel = 0 | 1 | 2 | 3;

export function recipeClassNames(state: MarkState): string {
  const r = STATE_CLIPS[state] ?? STATE_CLIPS.idle;
  return [
    "pibot-mark",
    `pibot-mark--${state}`,
    r.body && `pibot-mark--${r.body}`,
    r.eyes && `pibot-mark--${r.eyes}`,
    r.look && `pibot-mark--${r.look}`,
    r.orbit && `pibot-mark--${r.orbit}`,
    r.bits && `pibot-mark--${r.bits}`,
    r.pulse && `pibot-mark--${r.pulse}`,
  ]
    .filter(Boolean)
    .join(" ");
}
