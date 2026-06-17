export const tokens = {
  // Exact palette sampled from the heartsup Figma (file MLfKjQ1W1kscqxAX1UBja0).
  // Existing keys keep their semantic role; values are now the real design hexes.
  color: {
    primary: "#137afb",    // blue accent (tic-tac-toe board, dots)
    success: "#00aa54",    // green code banner
    danger: "#ff210a",     // red-orange CTA (START, pennant flags)
    accent: "#fae62f",     // title yellow
    accentGold: "#f9cb13", // deeper gold (title/button highlight)
    purple: "#7d2eb4",     // title drop-shadow / accent
    pink: "#ea5aa0",       // confetti accent (stars, dartboard)
    muted: "#dcdcdc",      // name-pill / muted label
    background: "#161616", // near-black confetti background
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
