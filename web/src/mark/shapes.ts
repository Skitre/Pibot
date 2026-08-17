import type { MarkShape } from "./assign";

/** 100×100，中心 50,50。剪影家族：同一光学框，边缘干净，小尺寸也像标志。 */
export interface ShapeFace {
  path: string;
  eyeDX: number;
  eyeDY: number;
}

const SHAPES: Record<MarkShape, ShapeFace> = {
  blob: {
    path: "M50 16C64 16 78 26 82 42C86 58 80 74 66 82C54 88 40 88 30 80C18 70 16 54 20 40C24 26 36 16 50 16Z",
    eyeDX: 2,
    eyeDY: -2,
  },
  pebble: {
    path: "M50 20C69 20 84 34 84 50C84 68 69 82 50 82C31 82 16 68 16 50C16 34 31 20 50 20Z",
    eyeDX: 1,
    eyeDY: -1,
  },
  squircle: {
    path: "M34 16H66C78 16 84 22 84 34V66C84 78 78 84 66 84H34C22 84 16 78 16 66V34C16 22 22 16 34 16Z",
    eyeDX: 0,
    eyeDY: -1,
  },
  tablet: {
    path: "M20 30C20 24 24 20 32 20H68C76 20 80 24 80 30V70C80 76 76 80 68 80H32C24 80 20 76 20 70V30Z",
    eyeDX: 0,
    eyeDY: 0,
  },
  wedge: {
    path: "M52 16C58 17 72 28 82 70C84 78 78 84 50 84C22 84 16 78 18 70C28 28 46 15 52 16Z",
    eyeDX: -6,
    eyeDY: 6,
  },
  hex: {
    path: "M50 16C54 16 58 18 68 24L82 44C84 48 84 52 82 56L68 76C64 82 58 84 50 84C42 84 36 82 32 76L18 56C16 52 16 48 18 44L32 24C36 18 46 16 50 16Z",
    eyeDX: 0,
    eyeDY: 0,
  },
  cloud: {
    path: "M36 36C40 26 52 22 60 28C66 22 78 24 80 36C88 38 90 50 84 58C86 68 78 76 66 74H36C24 76 18 66 22 56C16 50 20 38 30 36C32 36 34 36 36 36Z",
    eyeDX: 1,
    eyeDY: 4,
  },
  teardrop: {
    path: "M50 14C68 14 84 30 84 48C84 62 72 76 50 88C28 76 16 62 16 48C16 30 32 14 50 14Z",
    eyeDX: 0,
    eyeDY: -5,
  },
  diamond: {
    path: "M50 14C53 14 80 44 84 50C80 56 53 86 50 86C47 86 20 56 16 50C20 44 47 14 50 14Z",
    eyeDX: 0,
    eyeDY: 0,
  },
  shield: {
    path: "M50 12C56 12 74 16 82 22C84 38 82 58 50 88C18 58 16 38 18 22C26 16 44 12 50 12Z",
    eyeDX: 0,
    eyeDY: -2,
  },
  capsule: {
    path: "M50 14C66 14 76 24 76 40V60C76 76 66 86 50 86C34 86 24 76 24 60V40C24 24 34 14 50 14Z",
    eyeDX: 0,
    eyeDY: 0,
  },
  bean: {
    path: "M32 30C46 16 70 18 80 34C88 48 82 66 66 74C48 84 26 76 20 58C16 44 20 36 32 30Z",
    eyeDX: 2,
    eyeDY: 0,
  },
  moon: {
    path: "M72 16C42 18 18 36 18 56C18 78 40 90 70 86C60 80 56 68 56 54C56 38 64 24 72 16Z",
    eyeDX: -6,
    eyeDY: 2,
  },
  leaf: {
    path: "M52 12C74 24 86 48 78 68C70 84 50 88 36 78C22 66 20 44 32 28C40 18 46 14 52 12Z",
    eyeDX: 3,
    eyeDY: 2,
  },
  arch: {
    path: "M24 82C24 86 28 86 32 86H68C72 86 76 86 76 82V48C76 28 66 14 50 14C34 14 24 28 24 48V82Z",
    eyeDX: 0,
    eyeDY: -6,
  },
  heart: {
    path: "M50 84C22 62 14 48 16 34C18 22 30 16 40 18C46 20 48 24 50 30C52 24 54 20 60 18C70 16 82 22 84 34C86 48 78 62 50 84Z",
    eyeDX: 0,
    eyeDY: -8,
  },
};

export function shapeFace(shape: MarkShape): ShapeFace {
  return SHAPES[shape] ?? SHAPES.blob;
}
