import { tokens } from "../theme/tokens";
import type { ButtonHTMLAttributes } from "react";

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { style, ...rest } = props;
  return (
    <button
      {...rest}
      style={{
        background: tokens.color.primary,
        color: tokens.color.text,
        border: "none",
        borderRadius: tokens.radius.pill,
        padding: `${tokens.space[3]}px ${tokens.space[5]}px`,
        fontFamily: tokens.font.family,
        fontWeight: tokens.font.weightBold,
        fontSize: 18,
        cursor: "pointer",
        ...style,
      }}
    />
  );
}
