import { type DelimiterType, type InlineContext, type MarkdownConfig, parser } from '@lezer/markdown';

// CommonMark only closes emphasis when whitespace or punctuation sits on one side of the delimiter.
// CJK writing has neither between words, so `中的**二口女（ふたくちおんな）**意象` never closes its
// `**`. The renderer already reads it through marked-cjk-friendly; this teaches the editor the same
// rule so both agree on what is bold. The class is the one marked-cjk-friendly uses, copied verbatim
// from its `CJK` constant so the two cannot drift.
const CJK = new RegExp('[\\u1100-\\u11ff\\u20a9\\u2329-\\u232a\\u2630-\\u2637\\u268a-\\u268f\\u2e80-\\u2e99\\u2e9b-\\u2ef3\\u2f00-\\u2fd5\\u2ff0-\\u303e\\u3041-\\u3096\\u3099-\\u30ff\\u3105-\\u312f\\u3131-\\u318e\\u3190-\\u31e5\\u31ef-\\u321e\\u3220-\\u3247\\u3250-\\ua48c\\ua490-\\ua4c6\\ua960-\\ua97c\\uac00-\\ud7a3\\ud7b0-\\ud7c6\\ud7cb-\\ud7fb\\uf900-\\ufaff\\ufe10-\\ufe19\\ufe30-\\ufe52\\ufe54-\\ufe66\\ufe68-\\ufe6b\\uff01-\\uffbe\\uffc2-\\uffc7\\uffca-\\uffcf\\uffd2-\\uffd7\\uffda-\\uffdc\\uffe0-\\uffe6\\uffe8-\\uffee\\u{16fe0}-\\u{16fe4}\\u{16ff0}-\\u{16ff6}\\u{17000}-\\u{18cda}\\u{18cff}-\\u{18d20}\\u{18d80}-\\u{18df2}\\u{18e00}-\\u{19191}\\u{191a0}-\\u{191d2}\\u{1aff0}-\\u{1aff3}\\u{1aff5}-\\u{1affb}\\u{1affd}-\\u{1affe}\\u{1b000}-\\u{1b128}\\u{1b132}\\u{1b150}-\\u{1b152}\\u{1b155}\\u{1b164}-\\u{1b168}\\u{1b170}-\\u{1b2fb}\\u{1d300}-\\u{1d356}\\u{1d360}-\\u{1d376}\\u{1f1ae}\\u{1f200}\\u{1f202}\\u{1f210}-\\u{1f219}\\u{1f21b}-\\u{1f22e}\\u{1f230}-\\u{1f231}\\u{1f237}\\u{1f23b}\\u{1f240}-\\u{1f248}\\u{1f260}-\\u{1f265}\\u{1f7da}\\u{20000}-\\u{3fffd}]', 'u');
const PUNCTUATION = /[\p{S}\p{P}]/u;
const ALPHANUMERIC = /[\p{L}\p{N}]/u;

// `resolveMarkers` splits `**` into StrongEmphasis by comparing a delimiter against two objects that
// @lezer/markdown keeps private, so a replacement parser has to hand back those exact objects. Read
// them off a throwaway parse; an unrecognised build leaves the map empty and the built-in stands.
const delimiters = new Map<number, DelimiterType>();
parser.configure({
  parseInline: [{
    name: 'CjkEmphasisProbe',
    before: 'Emphasis',
    parse(cx) {
      for (const part of (cx as InlineContext & { parts: { type?: DelimiterType; from: number; }[]; }).parts) {
        if (part?.type?.resolve === 'Emphasis') delimiters.set(cx.char(part.from), part.type);
      }
      return -1;
    },
  }],
}).parse('_a_*b*.');

export const cjkEmphasis: MarkdownConfig = {
  parseInline: [{
    name: 'CjkEmphasis',
    before: 'Emphasis',
    parse(cx, next, start) {
      const type = delimiters.get(next);
      if (!type) return -1;
      let pos = start + 1;
      while (cx.char(pos) === next) pos++;
      const before = cx.slice(start - 1, start), after = cx.slice(pos, pos + 1);
      const pBefore = PUNCTUATION.test(before), pAfter = PUNCTUATION.test(after);
      const sBefore = /\s|^$/.test(before), sAfter = /\s|^$/.test(after);
      // CJK is neither whitespace nor punctuation, so on its own it never satisfies the clause that
      // lets a run flank. Letting a neighbouring CJK character satisfy it is the whole fix.
      const cjk = CJK.test(before) || CJK.test(after);
      const left = !sAfter && (!pAfter || sBefore || pBefore || cjk);
      const right = !sBefore && (!pBefore || sAfter || pAfter || cjk);
      const asterisk = next === 42;
      // Underscore additionally refuses to open inside a word, and a CJK character is a word
      // character, which is why `中_文_字` stays literal while `中的**粗體**文字` does not.
      const open = left && (asterisk || !(ALPHANUMERIC.test(before) && !pAfter));
      return cx.addDelimiter(type, start, pos, open, right && (asterisk || !left || pAfter || cjk));
    },
  }],
};
