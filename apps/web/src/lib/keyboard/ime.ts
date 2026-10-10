export interface CompositionTracker {
  /** True while composing, or right after `compositionend` (Safari commits with a keydown that follows it). */
  composing(event: KeyboardEvent): boolean;
  /** Starts watching `target` for `compositionend`; the returned function stops it. */
  attach(target: Document): () => void;
}

/** How long after `compositionend` a key still belongs to the IME, should the next task be late. */
const JUST_ENDED_MS = 100;

export function createCompositionTracker(): CompositionTracker {
  let endedAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ended = () => {
    endedAt = Date.now();
    clearTimeout(timer);
    timer = setTimeout(() => {
      endedAt = null;
    }, 0);
  };
  return {
    composing: event => event.isComposing || event.keyCode === 229 || (endedAt !== null && Date.now() - endedAt <= JUST_ENDED_MS),
    attach: target => {
      target.addEventListener('compositionend', ended, true);
      return () => {
        clearTimeout(timer);
        endedAt = null;
        target.removeEventListener('compositionend', ended, true);
      };
    },
  };
}

/** Unmodified keys (Enter, arrows, Escape, letters) are skipped while composing; Mod, Ctrl and Alt chords are not, since some IMEs report them as 229. */
export function skipForComposition(event: KeyboardEvent, tracker: CompositionTracker): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  return tracker.composing(event);
}
