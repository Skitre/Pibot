import { assignMark, MARK_COLOR_ORDER, MARK_COLORS, MARK_SHAPES, type MarkShape } from "../mark/assign";
import { BotMark } from "../mark/BotMark";
import { useT, type MessageKey } from "../i18n";

interface Props {
  botId: string;
  color: string;
  shape: MarkShape | null;
  onColor: (color: string) => void;
  onShape: (shape: MarkShape | null) => void;
}

function sameHex(a: string, b: string): boolean {
  return a.replace("#", "").toLowerCase() === b.replace("#", "").toLowerCase();
}

export function AvatarPicker({ botId, color, shape, onColor, onShape }: Props) {
  const tr = useT();
  const fallback = assignMark(botId);
  const currentShape = shape ?? fallback.shape;
  const palette = MARK_COLOR_ORDER.map((id) => MARK_COLORS[id] ?? "#1084FE");
  const extra = palette.some((hex) => sameHex(hex, color)) ? [] : [color];

  return (
    <div>
      <div style={colorHead}>
        <label style={{ ...label, marginBottom: 0 }}>{tr("editBot.color")}</label>
        <button style={resetBtn} type="button" onClick={() => { onColor(fallback.color); onShape(null); }}>
          {tr("editBot.resetLook")}
        </button>
      </div>
      <div style={swatchRow}>
        {extra.map((hex) => (
          <button
            key={hex}
            type="button"
            title={hex}
            style={swatch(hex, true)}
            onClick={() => onColor(hex)}
          />
        ))}
        {palette.map((hex) => (
          <button
            key={hex}
            type="button"
            title={hex}
            style={swatch(hex, sameHex(hex, color))}
            onClick={() => onColor(hex)}
          />
        ))}
      </div>

      <label style={{ ...label, marginTop: 14 }}>{tr("editBot.shape")}</label>
      <div style={shapeGrid}>
        {MARK_SHAPES.map((kind) => {
          const selected = kind === currentShape;
          return (
            <button
              key={kind}
              type="button"
              style={shapeBtn(selected)}
              onClick={() => onShape(kind)}
            >
              <BotMark id={botId} color={color} shape={kind} size={36} paused />
              <span style={shapeName}>{tr(`editBot.shape.${kind}` as MessageKey)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const colorHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 8,
};
const resetBtn: React.CSSProperties = {
  background: "var(--bg-active)",
  color: "var(--text-secondary)",
  fontSize: 12,
  padding: "6px 10px",
  borderRadius: 7,
};
const label: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "var(--text-secondary)",
  marginBottom: 8,
};
const swatchRow: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};
function swatch(hex: string, selected: boolean): React.CSSProperties {
  return {
    width: 22,
    height: 22,
    borderRadius: 999,
    background: hex,
    boxShadow: selected
      ? `0 0 0 2px var(--bg-sidebar), 0 0 0 4px ${hex === "#000000" ? "#e8e8ea" : hex}`
      : hex === "#000000"
        ? "inset 0 0 0 1px #3a3a3e"
        : "none",
    padding: 0,
  };
}
const shapeGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 8,
};
function shapeBtn(selected: boolean): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    padding: "10px 6px 8px",
    borderRadius: 10,
    background: selected ? "var(--bg-active)" : "var(--bg-input)",
    boxShadow: selected ? "inset 0 0 0 1px #5a5a60" : "none",
  };
}
const shapeName: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-secondary)",
};
