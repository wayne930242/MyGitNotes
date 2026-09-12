import { EditorNotice } from './EditorNotice.js';
import React from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { LocalDraft } from '../lib/types.js';

interface CrashRecoveryBannerProps {
  draft: LocalDraft;
  onRestore: () => void;
  onDiscard: () => void;
}

export const CrashRecoveryBanner: React.FC<CrashRecoveryBannerProps> = ({
  draft,
  onRestore,
  onDiscard,
}) => {
  const timeStr = new Date(draft.savedAt).toLocaleTimeString();

  return <EditorNotice actions={<>
    <button onClick={onRestore} className="flex items-center justify-center gap-1.5 px-3 py-1 bg-amber-600 text-white rounded-md text-xs font-medium hover:bg-amber-700 active:scale-95 transition"><RotateCcw className="w-4 h-4 shrink-0" />Restore Draft</button>
    <button onClick={onDiscard} className="flex items-center justify-center gap-1.5 px-3 py-1 border border-current rounded-md text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition"><Trash2 className="w-4 h-4 shrink-0" />Discard</button>
  </>}>
    <strong className="block">Unsaved draft available</strong>
    <p>A local draft from {timeStr} differs from the saved file.</p>
  </EditorNotice>;
};
