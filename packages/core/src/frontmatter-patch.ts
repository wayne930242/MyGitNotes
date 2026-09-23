import YAML from 'yaml';

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Length of a single-key document's rendered key, e.g. `2` for `a: 1\n` but `6` for a quoted
 * `"a: b": 1\n` — `key.length` alone is wrong whenever the key needs quoting or escaping.
 */
function renderedKeyEnd(rendered: string): number {
  const reparsed = YAML.parseDocument(rendered);
  return ((reparsed.contents as YAML.YAMLMap).items[0].key as YAML.Node).range![1];
}

/**
 * Sets, replaces or removes one frontmatter key in place: the key's own quoting, flow/block
 * style and surrounding comments are kept, and every other key and the Markdown body are left
 * untouched. `value === undefined` removes the key. Shared by note frontmatter patching and the
 * Agent skill metadata panel, so a hidden key's exact bytes (line endings, spacing, quoting)
 * survive an edit to a key the UI does expose.
 */
export function patchFrontmatterField(raw: string, key: string, value: unknown): string {
  const match = raw.match(FRONTMATTER_REGEX);
  if (!match) return raw;
  const yaml = match[1];
  const document = YAML.parseDocument(yaml);
  if (!YAML.isMap(document.contents)) return raw;
  const map = document.contents;
  const index = map.items.findIndex(item => YAML.isScalar(item.key) && item.key.value === key);
  const pair = map.items[index];
  const newline = match[0].includes('\r\n') ? '\r\n' : '\n';
  const offset = raw.indexOf('\n') + 1;
  const patch = (start: number, end: number, text: string) => raw.slice(0, offset + start) + text + raw.slice(offset + end);

  if (value === undefined) {
    if (!pair) return raw;
    let start = (pair.key as YAML.Node).range![0];
    let end = (pair.value as YAML.Node).range![2];
    if (map.flow) {
      end = (pair.value as YAML.Node).range![1];
      if (index < map.items.length - 1) end = (map.items[index + 1].key as YAML.Node).range![0];
      else if (index > 0) start = yaml.lastIndexOf(',', start);
    } else {
      start = yaml.lastIndexOf('\n', start - 1) + 1;
      // The extracted YAML omits the newline before the closing delimiter.
      if (end === yaml.length) end += newline.length;
    }
    return patch(start, end, !map.flow && map.items.length === 1 ? `{}${newline}` : '');
  }

  const isCollection = value !== null && typeof value === 'object';

  if (!pair) {
    let insertedValue: unknown = value;
    if (!isCollection) {
      const node = new YAML.Scalar(value);
      if (typeof value === 'string' && (key === 'created' || key === 'updated')) node.type = 'QUOTE_DOUBLE';
      insertedValue = node;
    }
    const newDocument = new YAML.Document({ [key]: insertedValue });
    if (isCollection && map.flow) {
      const newNode = newDocument.get(key, true);
      if (YAML.isSeq(newNode) || YAML.isMap(newNode)) newNode.flow = true;
    }
    const rendered = newDocument.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd();
    if (map.flow) {
      const end = yaml.lastIndexOf('}');
      return patch(end, end, `${map.items.length ? ', ' : ''}${rendered}`);
    }
    return patch(yaml.length, yaml.length, `${newline}${rendered}`);
  }

  const oldValue = pair.value as YAML.Node;

  if (isCollection || YAML.isSeq(oldValue) || YAML.isMap(oldValue)) {
    const flow = (YAML.isSeq(oldValue) || YAML.isMap(oldValue)) ? oldValue.flow === true : false;
    const newDocument = new YAML.Document({ [key]: value });
    if (flow) {
      const newNode = newDocument.get(key, true);
      if (YAML.isSeq(newNode) || YAML.isMap(newNode)) newNode.flow = true;
    }
    const rendered = newDocument.toString({ lineWidth: 0, flowCollectionPadding: false });
    const withoutKey = rendered.slice(renderedKeyEnd(rendered));
    const [vStart, vEnd] = oldValue.range!;
    const hadTrailingNewline = yaml.slice(vStart, vEnd).endsWith('\n');
    let replacement = !hadTrailingNewline && withoutKey.endsWith('\n') ? withoutKey.slice(0, -1) : withoutKey;
    if (match[0].includes('\r\n')) replacement = replacement.replace(/\n/g, '\r\n');
    return patch((pair.key as YAML.Node).range![1], vEnd, replacement);
  }

  const [, , cstEnd] = oldValue.range!;
  const isLastField = cstEnd === yaml.length;
  // The extracted YAML omits the newline before the closing delimiter, same as the deletion branch above.
  const consumeEnd = isLastField ? cstEnd + newline.length : cstEnd;
  const node = new YAML.Scalar(value);
  if (YAML.isScalar(oldValue) && ['QUOTE_SINGLE', 'QUOTE_DOUBLE'].includes(oldValue.type || '')) node.type = oldValue.type;
  if (typeof oldValue.comment === 'string') node.comment = oldValue.comment;
  // Rendered inside its own key so a multiline value gets a block-scalar indicator with
  // correctly indented content, matching where it would sit under the real key.
  const rendered = new YAML.Document({ [key]: node }).toString({ lineWidth: 0 });
  let replacement = rendered.slice(renderedKeyEnd(rendered));
  // As the last field, a value ending in a blank line is ambiguous with the closing `---`
  // delimiter's own separator: the shared frontmatter boundary match always attributes that one
  // newline to the delimiter, so a keep-chomped ("|+") value needs one extra newline of padding.
  if (isLastField && typeof value === 'string' && value.endsWith('\n\n')) replacement += '\n';
  if (match[0].includes('\r\n')) replacement = replacement.replace(/\n/g, '\r\n');
  return patch((pair.key as YAML.Node).range![1], consumeEnd, replacement);
}
