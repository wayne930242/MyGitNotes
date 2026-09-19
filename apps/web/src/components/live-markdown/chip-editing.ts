import { StateEffect, StateField } from '@codemirror/state';

/** Toggles a token chip (due/start/done/timestamp date) into or out of its inline editor. */
export const chipEditChanged = StateEffect.define<{ pos: number; editing: boolean; }>();

/** Positions whose token chip is currently showing its inline editor instead of its rendered chip. */
export const chipEditState = StateField.define<Set<number>>({
  create: () => new Set(),
  update(value, transaction) {
    const next = new Set([...value].map(pos => transaction.changes.mapPos(pos, -1)));
    for (const effect of transaction.effects) {
      if (effect.is(chipEditChanged)) {
        if (effect.value.editing) next.add(effect.value.pos);
        else next.delete(effect.value.pos);
      }
    }
    return next;
  },
});
