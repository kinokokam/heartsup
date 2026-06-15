import { tokens } from "../theme/tokens";
import type { PropsWithChildren } from "react";

export function ScreenBackground({ children }: PropsWithChildren) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: tokens.color.background,
        color: tokens.color.text,
        fontFamily: tokens.font.family,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: tokens.space[4],
      }}
    >
      {children}
    </div>
  );
}
