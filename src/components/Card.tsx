import { tokens } from "../theme/tokens";
import type { PropsWithChildren, CSSProperties } from "react";

export function Card({ children, style }: PropsWithChildren<{ style?: CSSProperties }>) {
  return (
    <div
      style={{
        background: tokens.color.primary,
        color: tokens.color.text,
        borderRadius: tokens.radius.lg,
        padding: tokens.space[5],
        ...style,
      }}
    >
      {children}
    </div>
  );
}
