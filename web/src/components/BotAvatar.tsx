import { forwardRef } from "react";
import { BotMark, type BotMarkHandle } from "../mark/BotMark";
import { isMarkShape, type MarkShape, type MarkState } from "../mark/assign";
import { useStore } from "../store";

interface Props {
  color?: string;
  shape?: MarkShape | null;
  size?: number;
  working?: boolean;
  thinking?: boolean;
  listening?: boolean;
  status?: string;
  state?: MarkState;
  /** 有 id 时形状/颜色可从 Bot 记录读取；同 Bot 永远同形 */
  id?: string;
  /** mono = 落地页字标：浅色 blob + 深色眼 */
  mono?: boolean;
}

function resolveState(p: Props): MarkState {
  if (p.state) return p.state;
  if (p.working) return "working";
  if (p.thinking) return "thinking";
  if (p.listening) return "listening";
  if (p.status === "starting" || p.status === "provisioning") return "spawning";
  if (p.status === "error") return "sad";
  if (p.status === "stopped") return "sleeping";
  return "idle";
}

export const BotAvatar = forwardRef<BotMarkHandle, Props>(function BotAvatar(props, ref) {
  const { size = 40, id, mono = false } = props;
  const stored = useStore((s) => (id ? s.bots.find((b) => b.id === id) : undefined));
  const color = props.color ?? stored?.avatar_color ?? "#1084FE";
  const storedShape = stored?.avatar_shape;
  const shape =
    props.shape === undefined
      ? isMarkShape(storedShape) ? storedShape : undefined
      : props.shape ?? undefined;
  return <BotMark ref={ref} id={id} color={color} shape={shape} size={size} state={resolveState(props)} mono={mono} />;
});
