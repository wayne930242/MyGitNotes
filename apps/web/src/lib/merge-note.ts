import { diff3Merge } from 'node-diff3';

export interface NoteDraft {
  content: string;
  metadata: Record<string, unknown>;
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  if (object(a) && object(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    return keys.every(key => sameValue(a[key], b[key]));
  }
  return false;
}
function mergeValue(base: unknown, local: unknown, remote: unknown): { conflict: boolean; value?: unknown; } {
  if (sameValue(local, remote) || sameValue(base, remote)) return { conflict: false, value: local };
  if (sameValue(base, local)) return { conflict: false, value: remote };
  if (object(base) && object(local) && object(remote)) {
    const value: Record<string, unknown> = Object.create(null);
    for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      const result = mergeValue(base[key], local[key], remote[key]);
      if (result.conflict) return result;
      if (result.value !== undefined) value[key] = result.value;
    }
    return { conflict: false, value };
  }
  return { conflict: true };
}
export function mergeNote(base: NoteDraft, local: NoteDraft, remote: NoteDraft): { conflict: true; } | { conflict: false; draft: NoteDraft; } {
  const metadata = mergeValue(base.metadata, local.metadata, remote.metadata);
  if (metadata.conflict) return { conflict: true };
  // Retain line terminators, including CRLF and the final newline.
  const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) || [];
  const blocks = diff3Merge(lines(local.content), lines(base.content), lines(remote.content), { excludeFalseConflicts: true });
  if (blocks.some(block => block.conflict)) return { conflict: true };
  return { conflict: false, draft: { content: blocks.flatMap(block => block.ok || []).join(''), metadata: metadata.value as Record<string, unknown> } };
}
