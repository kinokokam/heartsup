// Preset emoji avatars stored as a short string in profiles.avatar.
export const AVATARS = [
  "😀", "😎", "🤪", "🥳", "👽", "🤖", "🐱", "🐶",
  "🦊", "🦄", "🐸", "🐵", "🦖", "👾", "🌟", "🍕",
] as const;

export type Avatar = (typeof AVATARS)[number];
