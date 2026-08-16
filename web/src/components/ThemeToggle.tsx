import { prefs, usePrefs } from "../prefs";
import { useT } from "../i18n";
import { MoonIcon, SunIcon } from "./icons";

export function ThemeToggle() {
  const { theme } = usePrefs();
  const tr = useT();
  const toLight = theme === "dark";
  return (
    <button
      style={btn}
      title={toLight ? tr("chat.themeLight") : tr("chat.themeDark")}
      onClick={() => prefs.set({ theme: toLight ? "light" : "dark" })}
    >
      {toLight ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

const btn: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  display: "grid",
  placeItems: "center",
  color: "var(--text-secondary)",
};
