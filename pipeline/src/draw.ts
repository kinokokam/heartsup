export interface Combo {
  id: number;
  word_a_id: number;
  word_b_id: number;
  word_c_id?: number;
  coherence: number;
  last_used_round: number | null;
}

export interface PickOpts { currentRound: number; cooldown: number; floor?: number; }

// Pure selection: highest coherence among combos above the floor and off cooldown.
export function pickCombo(combos: Combo[], opts: PickOpts): Combo | null {
  const floor = opts.floor ?? 0;
  const eligible = combos.filter((c) => {
    if (c.coherence < floor) return false;
    if (c.last_used_round != null && opts.currentRound - c.last_used_round < opts.cooldown) return false;
    return true;
  });
  if (eligible.length === 0) return null;
  return eligible.reduce((best, c) => (c.coherence > best.coherence ? c : best));
}
