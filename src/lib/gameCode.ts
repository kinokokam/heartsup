export const GAME_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const GAME_CODE_LENGTH = 6;

export function normalizeGameCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidGameCode(code: string): boolean {
  if (code.length !== GAME_CODE_LENGTH) return false;
  for (const ch of code) if (!GAME_CODE_CHARS.includes(ch)) return false;
  return true;
}
