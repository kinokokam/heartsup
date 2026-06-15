export const tokens = {
  color: {
    primary: "#1d8cf8",   // heartsup blue
    success: "#2bd66a",   // green
    danger: "#ff3b30",    // red
    accent: "#ffd233",    // yellow
    background: "#0a0a0a",// near-black confetti bg
    text: "#ffffff",
  },
  radius: { sm: 8, md: 16, lg: 24, pill: 999 },
  space: [0, 4, 8, 12, 16, 24, 32, 48] as const,
  font: {
    family: "'Baloo 2', system-ui, sans-serif",
    weightBold: 800,
  },
} as const;

export type Tokens = typeof tokens;
