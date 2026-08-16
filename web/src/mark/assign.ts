/** 自己的分配：同 id 同外观。 */

export const MARK_SHAPES = [
  "blob",
  "pebble",
  "squircle",
  "tablet",
  "wedge",
  "hex",
  "cloud",
  "teardrop",
] as const;

export type MarkShape = (typeof MARK_SHAPES)[number];

/** v3 用到的生命周期 + 少量反应态。完整 39 态留给以后按需加。 */
export const MARK_STATES = [
  "idle",
  "listening",
  "thinking",
  "searching",
  "working",
  "sleeping",
  "spawning",
  "celebrate",
  "confused",
  "sad",
] as const;

export type MarkState = (typeof MARK_STATES)[number];

export const MARK_COLOR_ORDER = [
  "black",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "violet",
  "magenta",
  "gray",
] as const;

export const MARK_COLORS: Record<string, string> = {
  black: "#000000",
  brown: "#936439",
  red: "#FF263C",
  orange: "#FF6700",
  yellow: "#FF9800",
  green: "#00C972",
  cyan: "#00BCA6",
  blue: "#1084FE",
  violet: "#9159FE",
  magenta: "#FF309B",
  gray: "#777777",
};

const COLOR_BUCKETS = [
  "brown",
  "red",
  "red",
  "orange",
  "orange",
  "orange",
  "yellow",
  "yellow",
  "green",
  "green",
  "green",
  "cyan",
  "cyan",
  "blue",
  "blue",
  "blue",
  "violet",
  "violet",
  "violet",
  "magenta",
  "magenta",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "violet",
  "magenta",
] as const;

export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

export function isMarkShape(value: string | null | undefined): value is MarkShape {
  return !!value && (MARK_SHAPES as readonly string[]).includes(value);
}

export function assignMark(id: string): { shape: MarkShape; colorId: string; color: string } {
  const h = hashId(id);
  const colorId = COLOR_BUCKETS[h % COLOR_BUCKETS.length] ?? "blue";
  const shape = MARK_SHAPES[h % MARK_SHAPES.length] ?? "blob";
  return { shape, colorId, color: MARK_COLORS[colorId] ?? MARK_COLORS.blue };
}

export function shade(hex: string, amount: number): string {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return hex;
  const n = parseInt(raw, 16);
  const ch = (shift: number) => {
    const v = (n >> shift) & 255;
    return Math.max(0, Math.min(255, Math.round(v + amount)));
  };
  const r = ch(16);
  const g = ch(8);
  const b = ch(0);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

export function eyeFill(hex: string): string {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return "#fff";
  const n = parseInt(raw, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luma = (r * 299 + g * 587 + b * 114) / 1000;
  return luma > 160 ? "#1a1a1c" : "#fff";
}
