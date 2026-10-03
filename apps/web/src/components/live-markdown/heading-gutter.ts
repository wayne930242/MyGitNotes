import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Range, RangeSet, StateField } from '@codemirror/state';
import { GutterMarker, gutterLineClass } from '@codemirror/view';

/** Marks a heading line's gutter cells with its level, so the line number can sit beside the heading text. */
class HeadingGutterClass extends GutterMarker {
  elementClass: string;
  constructor(readonly level: number) {
    super();
    this.elementClass = `cm-heading-gutter cm-heading-gutter-${level}`;
  }
  eq(other: HeadingGutterClass) {
    return other.level === this.level;
  }
}

const markers = [1, 2, 3, 4, 5, 6].map(level => new HeadingGutterClass(level));

function headingLines(state: EditorState) {
  const ranges: Range<GutterMarker>[] = [];
  syntaxTree(state).iterate({
    enter: ({ name, from }) => {
      const level = /^(?:ATX|Setext)Heading([1-6])$/.exec(name)?.[1];
      if (level) ranges.push(markers[Number(level) - 1].range(state.doc.lineAt(from).from));
    },
  });
  return RangeSet.of(ranges, true);
}

/** Heading-level classes for the gutter, recomputed whenever the parser's tree changes. */
export const headingGutter = StateField.define<RangeSet<GutterMarker>>({
  create: headingLines,
  update: (value, transaction) => syntaxTree(transaction.state) === syntaxTree(transaction.startState) ? value : headingLines(transaction.state),
  provide: field => gutterLineClass.from(field),
});
