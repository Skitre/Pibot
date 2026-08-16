import type { Bot, Group } from "../types";
import { BotAvatar } from "./BotAvatar";
import { UsersIcon } from "./icons";

export type ClusterMember = Pick<Bot, "id"> & {
  avatar_color?: string;
  status?: string;
};

/** 几个 Bot 头像叠在一起，和群聊左上角同一套。 */
export function GroupCluster({
  members,
  size = 24,
  max = 3,
  overlap,
  workingIds,
}: {
  members: ClusterMember[];
  size?: number;
  max?: number;
  overlap?: number;
  workingIds?: Iterable<string>;
}) {
  const shown = members.slice(0, max);
  const pull = overlap ?? Math.round(size / 3);
  const busy = new Set(workingIds ?? []);
  if (shown.length === 0) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: "var(--bg-active)",
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
      >
        <UsersIcon size={Math.max(12, Math.round(size * 0.45))} color="var(--text-primary)" />
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexShrink: 0, alignItems: "center" }}>
      {shown.map((member, i) => (
        <div key={member.id} style={{ marginLeft: i === 0 ? 0 : -pull, zIndex: shown.length - i }}>
          <BotAvatar
            id={member.id}
            color={member.avatar_color}
            size={size}
            status={member.status}
            working={busy.has(member.id)}
          />
        </div>
      ))}
    </div>
  );
}

export function resolveGroupMembers(group: Pick<Group, "bot_ids">, bots: Bot[]): Bot[] {
  const ids = group.bot_ids ?? [];
  if (ids.length === 0) return [];
  const map = new Map(bots.map((bot) => [bot.id, bot]));
  return ids.map((id) => map.get(id)).filter((bot): bot is Bot => !!bot);
}
