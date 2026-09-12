import React, { useState, useEffect } from 'react';
import { X, GitCommit as GitCommitIcon, Sparkles, Check, FileDiff, AlertCircle } from 'lucide-react';
import { GitStatus } from '../lib/types.js';
import { fetchGitDiff, generateSemanticCommit, createCommit } from '../lib/api.js';

interface CommitModalProps {
  isOpen: boolean;
  previewDiff?: string;
  commitFiles?: (files: string[], message: string) => Promise<void>;
  onClose: () => void;
  gitStatus: GitStatus | null;
  onCommitted: () => Promise<void>;
}

export const CommitModal: React.FC<CommitModalProps> = props => props.isOpen ? <CommitModalContent {...props} /> : null;

const CommitModalContent: React.FC<CommitModalProps> = ({
  previewDiff,
  commitFiles,
  onClose,
  gitStatus,
  onCommitted,
}) => {

  const changedFiles = Array.from(new Set([
    ...(gitStatus?.staged || []),
    ...(gitStatus?.modified || []),
    ...(gitStatus?.untracked || []),
  ]));
  const fileKey = changedFiles.join('\0');
  const generatedMessage = `docs(notes): update ${changedFiles.length === 1 ? changedFiles[0].split('/').pop() : `${changedFiles.length} notes`}`;

  const [selectedFiles, setSelectedFiles] = useState<string[]>(changedFiles);
  const [localDiff, setDiff] = useState<string>('');
  const diff = previewDiff ?? localDiff;
  const [message, setMessage] = useState<string>(commitFiles ? generatedMessage : '');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isCommitting, setIsCommitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedFiles(previous => previous.filter(file => changedFiles.includes(file)));
    async function loadDiff() {
      try {
        const d = await fetchGitDiff();
        setDiff(d);
      } catch {
        setDiff('');
      }
    }
    if (previewDiff === undefined) void loadDiff();
  }, [fileKey, previewDiff]);

  const handleGenerateAiMessage = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const generated = commitFiles ? `docs(notes): update ${selectedFiles.length === 1 ? selectedFiles[0].split('/').pop() : `${selectedFiles.length} notes`}` : await generateSemanticCommit(diff, selectedFiles[0]);
      setMessage(generated);
    } catch {
      setMessage('minor-mod');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCommit = async () => {
    if (selectedFiles.length === 0) {
      setError('Please select at least one file to commit.');
      return;
    }
    if (!message.trim()) {
      setError('Please provide a commit message.');
      return;
    }

    setIsCommitting(true);
    setError(null);
    try {
      await (commitFiles || createCommit)(selectedFiles, message.trim());
      await onCommitted();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCommitting(false);
    }
  };

  const toggleFile = (file: string) => {
    setSelectedFiles((prev) =>
      prev.includes(file) ? prev.filter((f) => f !== file) : [...prev, file]
    );
  };

  return (
    <div className="viewport-overlay fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label="Commit changes" className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[85dvh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <GitCommitIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 text-sm">Commit Changes</h3>
              <p className="text-xs text-slate-400">
                Branch: <span className="font-mono text-indigo-600">{gitStatus?.branch}</span>
              </p>
            </div>
          </div>
          <button
            aria-label="Close commit" disabled={isCommitting} onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {changedFiles.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">
              <Check className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              Working tree is completely clean. No changes to commit.
            </div>
          ) : (
            <>
              {/* File list */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                  Files to Stage & Commit ({selectedFiles.length}/{changedFiles.length})
                </label>
                <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 bg-slate-50/30">
                  {changedFiles.map((file) => {
                    const isSelected = selectedFiles.includes(file);
                    return (
                      <label
                        key={file}
                        className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          aria-label={`Commit ${file}`} disabled={isCommitting}
                          checked={isSelected}
                          onChange={() => toggleFile(file)}
                          className="rounded text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="font-mono text-slate-800 break-all min-w-0">{file}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Commit Message Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Commit Message
                  </label>
                  <button
                    onClick={handleGenerateAiMessage}
                    disabled={isGenerating || changedFiles.length === 0}
                    className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 hover:underline font-medium disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    <Sparkles className="w-3 h-3 text-amber-500" />
                    <span>{isGenerating ? 'Generating...' : commitFiles ? 'Generate message' : 'Semantic Message (Gemini)'}</span>
                  </button>
                </div>
                <input
                  type="text"
                  aria-label="Commit message" disabled={isCommitting}
                  placeholder="e.g. docs(notes): update research notes"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              {/* Diff Snippet */}
              {diff && (
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mb-1">
                    <FileDiff className="w-3.5 h-3.5" />
                    <span>Diff Preview</span>
                  </div>
                  <pre className="max-h-40 overflow-y-auto p-3 bg-slate-900 text-slate-200 rounded-lg font-mono text-[11px] leading-relaxed">
                    {diff.slice(0, 3000)}
                    {diff.length > 3000 ? '\n...[truncated]' : ''}
                  </pre>
                </div>
              )}

              {error && (
                <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/50 flex items-center justify-end gap-2">
          <button
            disabled={isCommitting} onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          {changedFiles.length > 0 && (
            <button
              onClick={handleCommit}
              disabled={isCommitting}
              className="px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white rounded-lg shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isCommitting ? 'Committing...' : commitFiles ? 'Commit to GitHub' : 'Commit & Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
