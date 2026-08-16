import { useEffect, useState } from "react";
import type { Bot, BotSkill, ThinkingLevel } from "../types";
import { THINKING_LEVELS } from "../types";
import { api, apiErrorMessage } from "../api";
import { store, useStore } from "../store";
import { assignMark, isMarkShape, type MarkShape } from "../mark/assign";
import { AvatarPicker } from "./AvatarPicker";
import { BotAvatar } from "./BotAvatar";
import { CloseIcon } from "./icons";
import { useT } from "../i18n";

interface Props {
  bot: Bot;
  onClose: () => void;
}

export function EditBotModal({ bot, onClose }: Props) {
  const tr = useT();
  const profiles = useStore((s) => s.profiles);
  const [name, setName] = useState(bot.name);
  const [role, setRole] = useState(bot.role);
  const [color, setColor] = useState(bot.avatar_color);
  const [shape, setShape] = useState<MarkShape | null>(
    isMarkShape(bot.avatar_shape) ? bot.avatar_shape : null,
  );
  const [modelProfileId, setModelProfileId] = useState<string | null>(bot.model_profile_id);
  const [thinkingOverride, setThinkingOverride] = useState<ThinkingLevel | null>(
    bot.thinking_override,
  );
  const [skills, setSkills] = useState<BotSkill[]>([]);
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoadError("");
    setLoaded(false);
    api
      .getBotSettings(bot.id)
      .then(({ settings }) => {
        if (cancelled) return;
        setModelProfileId(settings.modelProfileId);
        setThinkingOverride(settings.thinkingOverride);
        setSkills(settings.skills);
        setEnabledIds(new Set(settings.skills.filter((s) => s.enabled === 1).map((s) => s.id)));
        setLoaded(true);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(apiErrorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [bot.id, reloadToken]);

  const defaultProfile = profiles.find((p) => p.is_default === 1) ?? profiles[0];
  const selectedProfile = modelProfileId
    ? (profiles.find((p) => p.id === modelProfileId) ?? defaultProfile)
    : defaultProfile;
  const effectiveThinking = thinkingOverride ?? selectedProfile?.thinking ?? "off";

  const toggleSkill = (id: string) => {
    setEnabledIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    if (!name.trim()) {
      setError(tr("editBot.nameRequired"));
      return;
    }
    if (!loaded) return;
    setBusy(true);
    setError("");
    try {
      await api.updateBot(bot.id, name.trim(), role.trim(), {
        avatar_color: color,
        avatar_shape: shape,
      });
      await api.updateBotSettings(bot.id, {
        modelProfileId,
        thinkingOverride,
        skillIds: [...enabledIds],
      });
      store.notifyBotSkillsChanged();
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <button style={closeBtn} onClick={onClose} title={tr("editBot.cancel")}>
          <CloseIcon />
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <BotAvatar id={bot.id} color={color} shape={shape ?? assignMark(bot.id).shape} size={40} />
          <h2 style={h2}>{tr("editBot.title")}</h2>
        </div>

        <div style={section}>{tr("editBot.profile")}</div>
        <AvatarPicker botId={bot.id} color={color} shape={shape} onColor={setColor} onShape={setShape} />
        <div style={{ height: 8 }} />
        <label style={label}>{tr("editBot.name")}</label>
        <input style={input} value={name} onChange={(e) => setName(e.target.value)} />

        <label style={{ ...label, marginTop: 14 }}>{tr("editBot.role")}</label>
        <textarea
          style={{ ...input, minHeight: 72, resize: "vertical" }}
          value={role}
          placeholder={tr("editBot.rolePh")}
          onChange={(e) => setRole(e.target.value)}
        />
        <div style={hint}>{tr("editBot.hint")}</div>

        <div style={section}>{tr("editBot.intelligence")}</div>
        <label style={label}>{tr("editBot.model")}</label>
        <select
          style={input}
          value={modelProfileId ?? ""}
          onChange={(e) => setModelProfileId(e.target.value || null)}
        >
          <option value="">
            {tr("editBot.followGlobal")}
            {defaultProfile ? ` (${defaultProfile.name})` : ""}
          </option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.model_id}
            </option>
          ))}
        </select>

        <label style={{ ...label, marginTop: 14 }}>{tr("editBot.thinking")}</label>
        <select
          style={input}
          value={thinkingOverride ?? ""}
          onChange={(e) =>
            setThinkingOverride((e.target.value || null) as ThinkingLevel | null)
          }
        >
          <option value="">
            {tr("editBot.followModel")}
            {selectedProfile ? ` (${selectedProfile.thinking})` : ""}
          </option>
          {THINKING_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
        <div style={hint}>
          {selectedProfile
            ? tr("editBot.effective", {
                model: selectedProfile.model_name,
                thinking: effectiveThinking,
              })
            : tr("editBot.effectiveNone")}
        </div>

        <div style={section}>{tr("editBot.skills")}</div>
        <div style={hint}>{tr("editBot.skillsHint")}</div>
        {loadError ? (
          <div style={errStyle}>
            {loadError}{" "}
            <button style={linkBtn} onClick={() => setReloadToken((n) => n + 1)}>
              {tr("editBot.retry")}
            </button>
          </div>
        ) : !loaded ? (
          <div style={hint}>{tr("editBot.loading")}</div>
        ) : skills.length === 0 ? (
          <div style={hint}>{tr("editBot.noSkills")}</div>
        ) : (
          <div style={skillList}>
            {skills.map((skill) => (
              <label key={skill.id} style={skillRow}>
                <input
                  type="checkbox"
                  checked={enabledIds.has(skill.id)}
                  onChange={() => toggleSkill(skill.id)}
                />
                <span>
                  <span style={{ fontWeight: 600 }}>{skill.name}</span>
                  <span style={{ color: "var(--text-secondary)", marginLeft: 8 }}>/{skill.slug}</span>
                  {skill.description ? (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                      {skill.description}
                    </div>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        )}

        {error && <div style={errStyle}>{error}</div>}

        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          <button style={primaryBtn} onClick={() => void save()} disabled={busy || !loaded}>
            {busy ? tr("editBot.saving") : tr("editBot.save")}
          </button>
          <button style={ghostBtn} onClick={onClose}>
            {tr("editBot.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--overlay)",
  display: "grid",
  placeItems: "center",
  zIndex: 45,
  backdropFilter: "blur(2px)",
};
const modal: React.CSSProperties = {
  width: 520,
  maxWidth: "92vw",
  maxHeight: "86vh",
  overflowY: "auto",
  background: "var(--bg-sidebar)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border-subtle)",
  borderRadius: 16,
  padding: "22px 24px",
  position: "relative",
  animation: "fade-up 0.2s ease",
};
const closeBtn: React.CSSProperties = {
  position: "absolute",
  top: 14,
  right: 14,
  width: 30,
  height: 30,
  borderRadius: 7,
  display: "grid",
  placeItems: "center",
  color: "var(--text-secondary)",
};
const h2: React.CSSProperties = { fontSize: 18, fontWeight: 600, margin: 0 };
const section: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--text-secondary)",
  margin: "18px 0 10px",
};
const label: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "var(--text-secondary)",
  marginBottom: 5,
};
const input: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-input)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border-subtle)",
  borderRadius: 8,
  padding: "8px 11px",
  fontSize: 13.5,
  outline: "none",
  color: "var(--text-primary)",
};
const hint: React.CSSProperties = {
  fontSize: 11.5,
  color: "var(--text-placeholder)",
  marginTop: 6,
  lineHeight: 1.5,
};
const skillList: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  marginTop: 10,
};
const skillRow: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  fontSize: 13,
  padding: "8px 10px",
  borderRadius: 8,
  background: "var(--bg-input)",
};
const errStyle: React.CSSProperties = { fontSize: 12, color: "#ef4444", marginTop: 10 };
const linkBtn: React.CSSProperties = {
  background: "none",
  color: "var(--accent-blue)",
  fontSize: 12,
  padding: 0,
};
const primaryBtn: React.CSSProperties = {
  background: "var(--btn-primary-bg)",
  color: "var(--btn-primary-fg)",
  fontWeight: 600,
  fontSize: 13,
  padding: "8px 18px",
  borderRadius: 8,
};
const ghostBtn: React.CSSProperties = {
  background: "var(--bg-active)",
  color: "var(--text-primary)",
  fontSize: 13,
  padding: "8px 18px",
  borderRadius: 8,
};
