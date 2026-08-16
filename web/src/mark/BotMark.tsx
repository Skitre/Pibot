import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type CSSProperties } from "react";
import { assignMark, eyeFill, type MarkShape, type MarkState } from "./assign";
import { BOUNCE_PRESETS, recipeClassNames, type BounceLevel } from "./clips";
import {
  bindPointer,
  gazeFromPoint,
  mergePose,
  poseFromGaze,
  POSE_HOME,
  readPointer,
  registerMark,
  type Point,
  type Pose,
} from "./gaze";
import { shapeFace } from "./shapes";

export interface BotMarkHandle {
  spin: (ms?: number) => void;
  bounce: (level?: BounceLevel) => void;
  burst: () => void;
}

export interface BotMarkProps {
  id?: string;
  color?: string;
  shape?: MarkShape;
  state?: MarkState;
  size?: number;
  mono?: boolean;
  /** 屏幕坐标；省略则跟全局指针；null 则回正 */
  gazeTarget?: Point | null;
  pose?: Partial<Pose>;
  poseHome?: Partial<Pose>;
  paused?: boolean;
  emphasis?: boolean;
  /** 自增时触发一次 spin */
  spinSignal?: number;
}

type Shot =
  | { kind: "spin"; key: number; ms: number }
  | { kind: "bounce"; key: number; level: BounceLevel }
  | { kind: "burst"; key: number };

export const BotMark = forwardRef<BotMarkHandle, BotMarkProps>(function BotMark(
  {
    id,
    color,
    shape,
    state = "idle",
    size = 40,
    mono = false,
    gazeTarget,
    pose,
    poseHome,
    paused = false,
    emphasis = false,
    spinSignal,
  },
  ref,
) {
  const uid = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const optsRef = useRef({ gazeTarget, pose, poseHome, paused });
  optsRef.current = { gazeTarget, pose, poseHome, paused };

  const assigned = id ? assignMark(id) : { shape: "blob" as const, color: "#1084FE" };
  const kind = shape ?? assigned.shape;
  const fill = mono ? "#f4f4f6" : color || assigned.color;
  const face = shapeFace(kind);
  const eyes = mono ? "#161618" : eyeFill(fill);
  const gClip = `mk-c-${uid}`;

  const [shot, setShot] = useState<Shot | null>(null);
  const prevState = useRef(state);
  const prevId = useRef(id);
  const lastSpin = useRef(spinSignal);

  useImperativeHandle(ref, () => ({
    spin(ms = 720) {
      setShot({ kind: "spin", key: Date.now(), ms });
    },
    bounce(level = 2) {
      setShot({ kind: "bounce", key: Date.now(), level });
    },
    burst() {
      setShot({ kind: "burst", key: Date.now() });
    },
  }));

  useEffect(() => {
    if (spinSignal && spinSignal !== lastSpin.current) {
      lastSpin.current = spinSignal;
      setShot({ kind: "spin", key: Date.now(), ms: 720 });
    }
  }, [spinSignal]);

  useEffect(() => {
    if (prevId.current !== id) {
      prevId.current = id;
      prevState.current = state;
      return;
    }
    if (prevState.current === "working" && state !== "working") {
      setShot({ kind: "bounce", key: Date.now(), level: 1 });
    }
    if (state === "spawning" && prevState.current !== "spawning") {
      setShot({ kind: "burst", key: Date.now() });
    }
    if (state === "celebrate" && prevState.current !== "celebrate") {
      setShot({ kind: "bounce", key: Date.now(), level: 3 });
    }
    prevState.current = state;
  }, [state, id]);

  useEffect(() => {
    if (!shot) return;
    const ms =
      shot.kind === "spin"
        ? shot.ms
        : shot.kind === "bounce"
          ? BOUNCE_PRESETS[shot.level].d * 1000
          : 620;
    const t = window.setTimeout(() => {
      setShot((cur) => (cur?.key === shot.key ? null : cur));
    }, ms + 40);
    return () => window.clearTimeout(t);
  }, [shot]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const unbind = bindPointer();
    const unreg = registerMark(el, () => {
      const o = optsRef.current;
      const home = mergePose(POSE_HOME, o.poseHome);
      if (o.paused || o.gazeTarget === null) {
        return { gaze: { x: 0, y: 0 }, pose: mergePose(home, o.pose) };
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) {
        return { gaze: { x: 0, y: 0 }, pose: home };
      }
      const pt = o.gazeTarget ?? readPointer();
      const gaze = gazeFromPoint(rect, pt.x, pt.y);
      return { gaze, pose: mergePose(poseFromGaze(gaze, home), o.pose) };
    });
    return () => {
      unreg();
      unbind();
    };
  }, []);

  const bounceH = shot?.kind === "bounce" ? Math.min(size * (BOUNCE_PRESETS[shot.level].h / 40), 22) : 10;
  const spinMs = shot?.kind === "spin" ? shot.ms : 720;
  const bounceLevel = shot?.kind === "bounce" ? shot.level : 2;

  const className = [
    recipeClassNames(state),
    paused ? "pibot-mark--paused" : "",
    emphasis ? "pibot-mark--emphasis" : "",
    shot ? `pibot-mark--oneshot-${shot.kind}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      ref={svgRef}
      className={className}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      overflow="visible"
      data-pibot-state={state}
      data-bounce={bounceLevel}
      style={
        {
          "--face-dx": face.eyeDX,
          "--face-dy": face.eyeDY,
          "--bounce-h": `${bounceH}px`,
          "--spin-ms": `${spinMs}ms`,
        } as CSSProperties
      }
      aria-hidden
    >
      <defs>
        <clipPath id={gClip}>
          <path d={face.path} />
        </clipPath>
      </defs>

      <circle className="pibot-mark__halo" cx="50" cy="50" r="46" fill={fill} />

      <g className="pibot-mark__orbit" stroke={fill} fill="none">
        <circle cx="50" cy="50" r="44" strokeWidth="1.1" />
        <circle className="pibot-mark__orbit-inner" cx="50" cy="50" r="38" strokeWidth="1" strokeDasharray="3 11" />
      </g>

      <g className="pibot-mark__stage">
        <g className="pibot-mark__pose">
          <g className="pibot-mark__float">
            <g className="pibot-mark__fit">
            <path className="pibot-mark__body" d={face.path} fill={fill} />

            <g className="pibot-mark__gaze" clipPath={`url(#${gClip})`}>
              <g className="pibot-mark__look">
                <g className="pibot-mark__face">
                  <g className="pibot-mark__eyes" fill={eyes}>
                    <rect className="pibot-mark__eye" x="39" y="36" width="8" height="20" rx="4" transform="rotate(12 43 46)" />
                    <rect className="pibot-mark__eye" x="55" y="36" width="8" height="20" rx="4" transform="rotate(12 59 46)" />
                  </g>
                </g>
              </g>
            </g>
            </g>
          </g>
        </g>
      </g>

      <g className="pibot-mark__bits" fill={fill}>
        <circle className="pibot-mark__bit pibot-mark__bit--a" cx="84" cy="28" r="2.6" />
        <circle className="pibot-mark__bit pibot-mark__bit--b" cx="18" cy="36" r="2" />
        <circle className="pibot-mark__bit pibot-mark__bit--c" cx="78" cy="72" r="2.2" />
      </g>
    </svg>
  );
});
