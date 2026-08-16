/** 全局指针 + 每颗 mark 的姿态插值。写 CSS 变量，不触发 React 重渲。 */

export type Pose = { turn: number; tilt: number; roll: number; scale: number };
export type Gaze = { x: number; y: number };
export type Point = { x: number; y: number };

export const POSE_HOME: Pose = { turn: 0, tilt: 0, roll: 0, scale: 1 };

type Target = { gaze: Gaze; pose: Pose };

type Driver = {
  el: SVGSVGElement;
  current: Gaze & Pose;
  getTarget: () => Target;
};

const drivers = new Set<Driver>();
const pointer: Point = { x: 0, y: 0 };
let raf = 0;
let pointerBound = 0;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function reducedMotion(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function gazeFromPoint(rect: DOMRect, x: number, y: number): Gaze {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return {
    x: clamp((x - cx) / Math.max(rect.width * 0.5, 6), -1.35, 1.35),
    y: clamp((y - cy) / Math.max(rect.height * 0.5, 6), -1.35, 1.35),
  };
}

export function poseFromGaze(g: Gaze, home: Pose = POSE_HOME): Pose {
  return {
    turn: home.turn + g.x * 0.64,
    tilt: home.tilt + g.y * 0.5,
    roll: home.roll + g.x * 0.09 + g.x * g.y * 0.06,
    scale: home.scale,
  };
}

export function mergePose(base: Pose, over?: Partial<Pose>): Pose {
  if (!over) return base;
  return {
    turn: over.turn ?? base.turn,
    tilt: over.tilt ?? base.tilt,
    roll: over.roll ?? base.roll,
    scale: over.scale ?? base.scale,
  };
}

function apply(el: SVGSVGElement, g: Gaze, p: Pose) {
  el.style.setProperty("--gaze-x", g.x.toFixed(4));
  el.style.setProperty("--gaze-y", g.y.toFixed(4));
  el.style.setProperty("--turn", p.turn.toFixed(4));
  el.style.setProperty("--tilt", p.tilt.toFixed(4));
  el.style.setProperty("--roll", p.roll.toFixed(4));
  el.style.setProperty("--mark-scale", p.scale.toFixed(4));
}

function tick() {
  raf = requestAnimationFrame(tick);
  const k = reducedMotion() ? 0.35 : 0.16;
  for (const d of drivers) {
    const t = d.getTarget();
    d.current.x += (t.gaze.x - d.current.x) * k;
    d.current.y += (t.gaze.y - d.current.y) * k;
    d.current.turn += (t.pose.turn - d.current.turn) * k;
    d.current.tilt += (t.pose.tilt - d.current.tilt) * k;
    d.current.roll += (t.pose.roll - d.current.roll) * k;
    d.current.scale += (t.pose.scale - d.current.scale) * k;
    apply(d.el, d.current, d.current);
  }
}

function onPointer(e: PointerEvent) {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
}

export function readPointer(): Point {
  return pointer;
}

export function bindPointer(): () => void {
  if (typeof window === "undefined") return () => undefined;
  pointerBound += 1;
  if (pointerBound === 1) {
    pointer.x = window.innerWidth * 0.5;
    pointer.y = window.innerHeight * 0.35;
    window.addEventListener("pointermove", onPointer, { passive: true });
  }
  return () => {
    pointerBound -= 1;
    if (pointerBound <= 0) {
      pointerBound = 0;
      window.removeEventListener("pointermove", onPointer);
    }
  };
}

export function registerMark(el: SVGSVGElement, getTarget: () => Target): () => void {
  const d: Driver = {
    el,
    current: { x: 0, y: 0, ...POSE_HOME },
    getTarget,
  };
  apply(el, { x: 0, y: 0 }, POSE_HOME);
  drivers.add(d);
  if (!raf) raf = requestAnimationFrame(tick);
  return () => {
    drivers.delete(d);
    if (!drivers.size && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}
