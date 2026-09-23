import React from 'react';
import { highlightSegments } from '../lib/search-highlight.js';

/** Renders `text` plainly, or with the query's matches wrapped in `<mark>` while a search is active. */
export const HighlightText: React.FC<{ text: string; query: string; }> = ({ text, query }) => {
  const segments = highlightSegments(text, query);
  if (segments.length === 1 && !segments[0].match) return <>{text}</>;
  return <>{segments.map((segment, index) => segment.match ? <mark key={index} className='bg-primary-soft text-fg rounded-sm'>{segment.text}</mark> : <React.Fragment key={index}>{segment.text}</React.Fragment>)}</>;
};
