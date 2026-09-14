import { createLoader, createParser, createSerializer, parseAsBoolean, parseAsNativeArrayOf, parseAsString, parseAsStringLiteral } from 'nuqs/server';
import { safeFilterPath } from '@github-notes/core/note-filters';

const pathParser = createParser({ parse: value => safeFilterPath(value) ? value : null, serialize: value => value });
export const filterParsers = {
  q: parseAsString.withDefault(''),
  tag: parseAsNativeArrayOf(parseAsString),
  folders: parseAsNativeArrayOf(pathParser),
  descendants: parseAsBoolean.withDefault(true),
  tagMode: parseAsStringLiteral(['any', 'all']).withDefault('any'),
  status: parseAsString,
  showHidden: parseAsBoolean.withDefault(false),
  neighbors: parseAsBoolean.withDefault(false),
  view: parseAsStringLiteral(['flat', 'list', 'card', 'kanban', 'graph']).withDefault('flat'),
};
export const readFilterQuery = createLoader(filterParsers);
export const writeFilterQuery = createSerializer(filterParsers);
export type FilterQuery = Awaited<ReturnType<typeof readFilterQuery>>;
