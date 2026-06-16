import { tokens } from "../theme/tokens";
import { AVATARS } from "../data/avatars";

export function EmojiPicker({ value, onChange }: { value: string | null; onChange: (emoji: string) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: tokens.space[2], justifyContent: "center", maxWidth: 320 }}>
      {AVATARS.map((emoji) => {
        const selected = emoji === value;
        return (
          <button
            key={emoji}
            type="button"
            aria-label={emoji}
            aria-pressed={selected}
            onClick={() => onChange(emoji)}
            style={{
              fontSize: 28,
              width: 48,
              height: 48,
              borderRadius: tokens.radius.md,
              border: selected ? `3px solid ${tokens.color.accent}` : "3px solid transparent",
              background: selected ? tokens.color.primary : "rgba(255,255,255,0.08)",
              cursor: "pointer",
            }}
          >
            {emoji}
          </button>
        );
      })}
    </div>
  );
}
