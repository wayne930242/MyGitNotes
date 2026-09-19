import React from 'react';
import { Tag } from 'lucide-react';
import { TagActions } from './TagActions.js';

export interface NoteTagActions {
  allTags: string[];
  onPreviewUsage: (tag: string) => Promise<number>;
  onRename: (from: string, to: string) => Promise<void>;
  onMerge: (from: string, into: string) => Promise<void>;
  onDelete: (tag: string) => Promise<void>;
}

/** A note's tag chips inside a list row or card; clicks here stay on the tags instead of opening the note. */
export const NoteTags: React.FC<{ tags: string[]; chipClassName: string; tagActions?: NoteTagActions; className?: string; children?: React.ReactNode }> = ({ tags, chipClassName, tagActions, className = '', children }) => (
  <div className={`note-tags flex flex-wrap gap-1 ${className}`} onClick={event => event.stopPropagation()}>
    {tags.map(tag => {
      const chip = (
        <span className={`inline-flex items-center gap-1 bg-sidebar text-muted rounded ${chipClassName}`}>
          <Tag className="w-2.5 h-2.5 text-muted shrink-0" />
          <span className="min-w-0 break-words">{tag}</span>
        </span>
      );
      return tagActions ? (
        <div key={tag} className="sidebar-tag-row inline-flex items-center max-w-full">
          <TagActions tag={tag} {...tagActions}>{chip}</TagActions>
        </div>
      ) : <React.Fragment key={tag}>{chip}</React.Fragment>;
    })}
    {children}
  </div>
);
