import { SourceError } from './remote-source.js';
import { matchNoteGlob } from './note-shell.js';
import { NoteItem } from './types.js';

export interface NoteSearchOptions {
  query?: string;
  isRegex?: boolean;
  caseSensitive?: boolean;
  notebookId?: string;
  status?: string;
  tags?: string[];
  pattern?: string;
  limit?: number;
}

export interface NoteSearchMatch {
  path: string;
  title: string;
  notebookId: string;
  status: string | null;
  tags: string[];
  matchCount: number;
  score: number;
  matchedTerms: string[];
  snippet: string;
}

const HAN = /\p{Script=Han}/u;
// Field weights: identifiers an agent is likely to type (title, path slug, citation key, tags) outrank body prose.
const WEIGHT = { title: 4, path: 3, metadata: 3, content: 1 };

/** Splits a free-text query into terms; long Han runs also contribute bigrams so partial Chinese phrasing still matches. */
export function searchTerms(query: string, caseSensitive = false): { term: string; weight: number }[] {
  const words = (caseSensitive ? query : query.toLowerCase()).split(/[\s,，、。;；:：!！?？()（）「」『』《》〈〉"'“”‘’\[\]]+/u).filter(Boolean);
  const terms = new Map<string, number>();
  for (const word of words) {
    terms.set(word, Math.max(terms.get(word) || 0, 1));
    if (HAN.test(word) && [...word].length > 2) {
      const chars = [...word];
      for (let i = 0; i + 2 <= chars.length; i++) {
        const bigram = chars.slice(i, i + 2).join('');
        if (HAN.test(bigram)) terms.set(bigram, Math.max(terms.get(bigram) || 0, 0.5));
      }
    }
  }
  return [...terms].map(([term, weight]) => ({ term, weight }));
}

function count(haystack: string, needle: string) {
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

function metadataText(note: NoteItem) {
  return Object.entries(note.metadata)
    .filter(([key]) => key !== 'title')
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('\n');
}

function snippetFor(content: string, needles: string[], lower: boolean) {
  let best = '';
  let bestHits = 0;
  for (const line of content.split('\n')) {
    const text = lower ? line.toLowerCase() : line;
    const hits = needles.filter((n) => text.includes(n)).length;
    if (hits > bestHits) { best = line; bestHits = hits; }
  }
  return best.trim().slice(0, 240);
}

/**
 * Ranks notes for an agent: metadata filters narrow the set, then literal terms are scored
 * across title, path, frontmatter and body (BM25-style saturation with inverse document frequency).
 * A regular expression query keeps exact regex semantics and ranks by match count.
 */
export function searchNotes(notes: NoteItem[], options: NoteSearchOptions) {
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new SourceError('limit must be an integer from 1 to 200.');
  const query = options.query && options.query.trim() ? options.query : '';
  const wantedTags = (options.tags || []).map((t) => t.toLowerCase());
  if (!query && !options.status && !wantedTags.length && !options.pattern && !options.notebookId) {
    throw new SourceError('Provide query or at least one filter (notebookId, status, tags, pattern).');
  }
  const matcher = options.pattern ? matchNoteGlob(options.pattern) : null;
  const candidates = notes.filter((note) =>
    (!options.notebookId || note.notebookId === options.notebookId) &&
    (!options.status || note.status === options.status) &&
    wantedTags.every((tag) => note.tags.some((t) => t.toLowerCase() === tag)) &&
    (!matcher || matcher(note.path)));

  const sensitive = options.caseSensitive === true;
  const fold = (text: string) => (sensitive ? text : text.toLowerCase());
  const scored: NoteSearchMatch[] = [];
  const base = (note: NoteItem) => ({ path: note.path, title: note.title, notebookId: note.notebookId, status: note.status ?? null, tags: note.tags });

  if (!query) {
    for (const note of candidates) scored.push({ ...base(note), matchCount: 0, score: 0, matchedTerms: [], snippet: '' });
    scored.sort((a, b) => a.path.localeCompare(b.path));
  } else if (options.isRegex) {
    let regex: RegExp;
    try { regex = new RegExp(query, sensitive ? 'g' : 'gi'); } catch (err) { throw new SourceError(`Invalid regular expression: ${(err as Error).message}`); }
    const lineRegex = new RegExp(query, sensitive ? '' : 'i');
    for (const note of candidates) {
      const hits = [...(note.content.match(regex) || []), ...(note.title.match(regex) || [])];
      if (!hits.length) continue;
      const line = note.content.split('\n').find((l) => lineRegex.test(l)) || '';
      scored.push({ ...base(note), matchCount: hits.length, score: hits.length, matchedTerms: [...new Set(hits)].slice(0, 10), snippet: line.trim().slice(0, 240) });
    }
    scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  } else {
    const phrase = fold(query.trim());
    const terms = searchTerms(query, sensitive);
    const docs = candidates.map((note) => ({
      note,
      fields: { title: fold(note.title), path: fold(note.path), metadata: fold(metadataText(note)), content: fold(note.content) },
    }));
    const df = new Map(terms.map(({ term }) => [term, docs.filter((d) => Object.values(d.fields).some((f) => f.includes(term))).length]));
    const avgLength = docs.reduce((sum, d) => sum + d.fields.content.length, 0) / Math.max(docs.length, 1) || 1;
    const primaryWeight = terms.reduce((sum, t) => sum + (t.weight === 1 ? 1 : 0), 0) || 1;
    for (const { note, fields } of docs) {
      let score = 0;
      let matchCount = 0;
      const matched: string[] = [];
      let primaryMatched = 0;
      for (const { term, weight } of terms) {
        const idf = Math.log(1 + (docs.length - df.get(term)! + 0.5) / (df.get(term)! + 0.5));
        let tf = 0;
        for (const field of Object.keys(WEIGHT) as (keyof typeof WEIGHT)[]) {
          const n = count(fields[field], term);
          if (weight === 1 && (field === 'content' || field === 'title')) matchCount += n;
          tf += WEIGHT[field] * n;
        }
        if (!tf) continue;
        matched.push(term);
        if (weight === 1) primaryMatched++;
        const norm = 1.2 * (0.25 + 0.75 * fields.content.length / avgLength);
        score += weight * idf * (tf * 2.2) / (tf + norm);
      }
      if (!matched.length) continue;
      const phraseHits = count(fields.title, phrase) + count(fields.path, phrase) + count(fields.content, phrase) + count(fields.metadata, phrase);
      if (phraseHits) score *= 2;
      // Notes covering more of the query's distinct words rank above notes repeating one word.
      score *= 0.5 + 0.5 * primaryMatched / primaryWeight;
      scored.push({ ...base(note), matchCount: Math.max(matchCount, phraseHits), score: Number(score.toFixed(3)), matchedTerms: matched, snippet: snippetFor(note.content, matched, !sensitive) });
    }
    scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  }
  return { matches: scored.slice(0, limit), total: scored.length, truncated: scored.length > limit };
}
