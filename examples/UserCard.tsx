// AI が書きがちな「ふつうの入力ではきれいに見える」カード。uifuzz にかけると壊れが見つかる
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

export function UserCard({ name, role, bio, tags, followers, onFollow }: UserCardProps) {
  return (
    <div className="card" style={{ width: 320, border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
      <div className="header" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="name" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{name}</span>
        <span className="badge" style={{ fontSize: 12, background: "#eef", padding: "0 6px" }}>
          {ROLE_LABEL[role]}
        </span>
        <button className="follow" onClick={onFollow} style={{ marginLeft: "auto", fontSize: 10, padding: "2px 4px" }}>
          +
        </button>
      </div>
      <p className="bio" style={{ height: 40, overflow: "hidden", margin: "8px 0" }}>
        {bio!.trim()}
      </p>
      <div className="tags" style={{ display: "flex", gap: 4 }}>
        {tags.map((tag, i) => (
          <span key={i} className="tag" style={{ whiteSpace: "nowrap", fontSize: 12, background: "#f3f3f3", padding: "0 4px" }}>
            #{tag}
          </span>
        ))}
      </div>
      <div className="stats" style={{ fontSize: 12, color: "#666", marginTop: 8 }}>
        {followers.toLocaleString()} フォロワー
      </div>
    </div>
  );
}
