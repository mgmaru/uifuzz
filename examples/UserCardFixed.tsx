// uifuzz の指摘を直した版。同じ入力をすべて通る
type Role = "admin" | "member" | "guest";

export interface UserCardProps {
  name: string;
  role: Role;
  bio?: string;
  tags: string[];
  followers: number;
  onFollow: () => void;
}

const ROLE_LABEL: Record<Role, string> = { admin: "管理者", member: "メンバー", guest: "ゲスト" };
const MAX_TAGS = 5;

const ellipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

export function UserCardFixed({ name, role, bio, tags, followers, onFollow }: UserCardProps) {
  const shown = tags.slice(0, MAX_TAGS);
  return (
    <div className="card" style={{ width: "100%", maxWidth: 320, boxSizing: "border-box", border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
      <div className="header" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="name" style={{ fontWeight: 700, minWidth: 0, flex: 1, ...ellipsis }}>{name}</span>
        <span className="badge" style={{ fontSize: 12, background: "#eef", padding: "0 6px", flexShrink: 0 }}>
          {ROLE_LABEL[role]}
        </span>
        <button className="follow" onClick={onFollow} aria-label="フォロー" style={{ minWidth: 32, minHeight: 32, flexShrink: 0 }}>
          +
        </button>
      </div>
      {bio?.trim() && (
        <p className="bio" style={{ margin: "8px 0", overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {bio.trim()}
        </p>
      )}
      <div className="tags" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {shown.map((tag, i) => (
          <span key={i} className="tag" style={{ maxWidth: "100%", fontSize: 12, background: "#f3f3f3", padding: "0 4px", boxSizing: "border-box", ...ellipsis }}>
            #{tag}
          </span>
        ))}
        {tags.length > MAX_TAGS && (
          <span className="more" style={{ fontSize: 12, color: "#666" }}>+{tags.length - MAX_TAGS}</span>
        )}
      </div>
      <div className="stats" style={{ fontSize: 12, color: "#666", marginTop: 8, overflowWrap: "anywhere" }}>
        {Math.max(0, Math.floor(followers)).toLocaleString()} フォロワー
      </div>
    </div>
  );
}
