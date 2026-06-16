import { useState } from "react";
import { tokens } from "../theme/tokens";

export function GameCodeBadge({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) return;
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (non-secure context / permission denied); no-op.
    }
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: tokens.space[3] }}>
      <span
        style={{
          fontFamily: tokens.font.family,
          fontWeight: tokens.font.weightBold,
          fontSize: 32,
          letterSpacing: 4,
          background: "rgba(255,255,255,0.1)",
          padding: `${tokens.space[2]}px ${tokens.space[4]}px`,
          borderRadius: tokens.radius.md,
        }}
      >
        {code}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy game code"
        style={{
          background: tokens.color.accent,
          color: "#000",
          border: "none",
          borderRadius: tokens.radius.pill,
          padding: `${tokens.space[2]}px ${tokens.space[3]}px`,
          fontWeight: tokens.font.weightBold,
          cursor: "pointer",
        }}
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}
