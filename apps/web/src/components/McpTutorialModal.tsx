import React, { useState } from 'react';
import { X, Copy, Check, ExternalLink, Bot, Terminal, Code2, Sparkles, AlertCircle, HelpCircle } from 'lucide-react';
import { copyToClipboard as copyText } from '../lib/clipboard.js';

interface McpTutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeUrl?: string;
}

type TabType = 'chatgpt' | 'claude' | 'general';

export const McpTutorialModal: React.FC<McpTutorialModalProps> = ({
  isOpen,
  onClose,
  activeUrl,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('chatgpt');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!isOpen) return null;

  const displayUrl = activeUrl || (typeof window !== 'undefined' ? `${window.location.origin}/mcp/<TOKEN>` : 'https://<YOUR_HOST>/mcp/<TOKEN>');

  const copyToClipboard = async (text: string, key: string) => {
    const ok = await copyText(text);
    if (ok) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  const claudeDesktopConfig = JSON.stringify(
    {
      mcpServers: {
        'github-notes': {
          url: displayUrl,
        },
      },
    },
    null,
    2
  );

  const claudeLocalStdioConfig = JSON.stringify(
    {
      mcpServers: {
        'github-notes': {
          command: 'node',
          args: [
            '/path/to/github-notes/packages/mcp-server/dist/index.js',
            '/path/to/your/workspace',
          ],
        },
      },
    },
    null,
    2
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[90vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden text-slate-900 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-sm"
              style={{ backgroundColor: 'var(--color-primary, #4f46e5)' }}
            >
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                MCP Connector Guide
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Connect your GitHub Notes workspace to ChatGPT, Claude, or any AI editor
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5 transition"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center px-6 pt-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 gap-2 shrink-0 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('chatgpt')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition -mb-px whitespace-nowrap ${
              activeTab === 'chatgpt'
                ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Bot className="w-4 h-4" />
            <span>ChatGPT Connector</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('claude')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition -mb-px whitespace-nowrap ${
              activeTab === 'claude'
                ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>Claude (Desktop / Code)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition -mb-px whitespace-nowrap ${
              activeTab === 'general'
                ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Code2 className="w-4 h-4" />
            <span>Generic MCP (Cursor / Windsurf)</span>
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Active URL notice if available */}
          {activeUrl && (
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs flex flex-col gap-2 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  Active MCP connection URL included
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(activeUrl, 'active-url')}
                  className="flex items-center gap-1 px-2.5 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition font-medium shrink-0"
                >
                  {copiedKey === 'active-url' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey === 'active-url' ? 'Copied' : 'Copy URL'}</span>
                </button>
              </div>
              <code className="text-[11px] font-mono bg-white dark:bg-slate-950 p-2 rounded border border-slate-200 dark:border-slate-800 break-all select-all text-slate-800 dark:text-slate-200">
                {activeUrl}
              </code>
            </div>
          )}

          {/* TAB 1: ChatGPT */}
          {activeTab === 'chatgpt' && (
            <div className="space-y-6">
              <div className="p-3.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">Prerequisites: </span>
                  Custom connectors in ChatGPT require a Plus, Pro, Team, Business, or Edu plan with Developer Mode enabled in Settings.
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Setup Steps
                </h3>

                {/* Step 1 */}
                <div className="flex gap-3.5 items-start p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                  <span className="w-6 h-6 rounded-full bg-indigo-600 dark:bg-indigo-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
                    1
                  </span>
                  <div className="flex-1 text-xs">
                    <p className="font-semibold text-slate-800 dark:text-slate-200">
                      Open ChatGPT Connectors settings and enable Developer Mode
                    </p>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                      Go to ChatGPT Settings → Connectors, turn on the Developer Mode toggle, then click Create Application.
                    </p>
                    <a
                      href="https://chatgpt.com/#settings/Connectors"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-2 text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                    >
                      Open ChatGPT Connectors settings <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="flex gap-3.5 items-start p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                  <span className="w-6 h-6 rounded-full bg-indigo-600 dark:bg-indigo-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
                    2
                  </span>
                  <div className="flex-1 text-xs">
                    <p className="font-semibold text-slate-800 dark:text-slate-200">
                      Configure name and MCP Server URL
                    </p>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                      Set Name to <code className="font-mono bg-black/5 dark:bg-white/10 px-1 py-0.5 rounded">GitHub Notes</code>. In the Server URL field, paste the MCP connection URL below:
                    </p>
                    <div className="relative mt-2 flex items-center gap-2 bg-slate-900 text-slate-100 p-2.5 rounded-lg font-mono text-[11px]">
                      <code className="flex-1 break-all select-all">{displayUrl}</code>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(displayUrl, 'chatgpt-url')}
                        className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-xs transition shrink-0 flex items-center gap-1"
                      >
                        {copiedKey === 'chatgpt-url' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedKey === 'chatgpt-url' ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="flex gap-3.5 items-start p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                  <span className="w-6 h-6 rounded-full bg-indigo-600 dark:bg-indigo-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
                    3
                  </span>
                  <div className="flex-1 text-xs">
                    <p className="font-semibold text-slate-800 dark:text-slate-200">
                      Set Authentication to &quot;No authentication&quot;
                    </p>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                      Important: In the Authentication dropdown, select <strong>No authentication</strong>. The GitHub Notes connection URL contains a dedicated token that provides access directly.
                    </p>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                      Check the terms agreement checkbox and click <strong>Create</strong> to complete registration.
                    </p>
                  </div>
                </div>

                {/* Step 4 */}
                <div className="flex gap-3.5 items-start p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                  <span className="w-6 h-6 rounded-full bg-indigo-600 dark:bg-indigo-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
                    4
                  </span>
                  <div className="flex-1 text-xs">
                    <p className="font-semibold text-slate-800 dark:text-slate-200">
                      Start chatting with your notes
                    </p>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                      In the ChatGPT chat input, click the &quot;+&quot; button (or explore apps), select &quot;GitHub Notes&quot;, and ask ChatGPT to read, search, or update your notes!
                    </p>
                  </div>
                </div>
              </div>

              {/* Sample Prompts */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Try these example prompts (click to copy)
                </h4>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    'List all my notes and tag hierarchy in GitHub Notes',
                    'Search my notes for architecture decisions and summarize them',
                    'Create a new note titled "2026 Product Roadmap" in the ideas notebook',
                  ].map((prompt, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => copyToClipboard(prompt, `prompt-${idx}`)}
                      className="w-full flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700 bg-white dark:bg-slate-900/80 text-left text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition group"
                    >
                      <span className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        <span>{prompt}</span>
                      </span>
                      <span className="text-[11px] text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 flex items-center gap-1 shrink-0">
                        {copiedKey === `prompt-${idx}` ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedKey === `prompt-${idx}` ? 'Copied' : 'Copy'}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Claude */}
          {activeTab === 'claude' && (
            <div className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Option A: Claude Desktop Configuration
                </h3>
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-xs space-y-3">
                  <p className="text-slate-600 dark:text-slate-400">
                    Open your Claude Desktop configuration file <code className="font-mono bg-black/5 dark:bg-white/10 px-1 py-0.5 rounded">claude_desktop_config.json</code>:
                  </p>
                  <ul className="list-disc pl-5 space-y-1 text-slate-500 dark:text-slate-400 text-[11px]">
                    <li><strong>macOS:</strong> <code className="font-mono">~/Library/Application Support/Claude/claude_desktop_config.json</code></li>
                    <li><strong>Windows:</strong> <code className="font-mono">%APPDATA%\Claude\claude_desktop_config.json</code></li>
                    <li><strong>Linux:</strong> <code className="font-mono">~/.config/Claude/claude_desktop_config.json</code></li>
                  </ul>

                  <div className="pt-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        Add to mcpServers (Remote / HTTP SSE mode):
                      </span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(claudeDesktopConfig, 'claude-desktop-cfg')}
                        className="flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                      >
                        {copiedKey === 'claude-desktop-cfg' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedKey === 'claude-desktop-cfg' ? 'Copied' : 'Copy JSON'}</span>
                      </button>
                    </div>
                    <pre className="p-3 rounded-lg bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto">
                      {claudeDesktopConfig}
                    </pre>
                  </div>

                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        Or use local Stdio mode (runs local CLI directly):
                      </span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(claudeLocalStdioConfig, 'claude-stdio-cfg')}
                        className="flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                      >
                        {copiedKey === 'claude-stdio-cfg' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedKey === 'claude-stdio-cfg' ? 'Copied' : 'Copy JSON'}</span>
                      </button>
                    </div>
                    <pre className="p-3 rounded-lg bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto">
                      {claudeLocalStdioConfig}
                    </pre>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Option B: Claude Code (CLI)
                </h3>
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-xs space-y-2">
                  <p className="text-slate-600 dark:text-slate-400">
                    Run the following command in your terminal to register GitHub Notes with Claude Code:
                  </p>
                  <div className="relative flex items-center gap-2 bg-slate-900 text-slate-100 p-2.5 rounded-lg font-mono text-[11px]">
                    <code className="flex-1 break-all select-all">
                      claude mcp add github-notes -- {displayUrl}
                    </code>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(`claude mcp add github-notes -- ${displayUrl}`, 'claude-cli')}
                      className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-xs transition shrink-0 flex items-center gap-1"
                    >
                      {copiedKey === 'claude-cli' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedKey === 'claude-cli' ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: General MCP */}
          {activeTab === 'general' && (
            <div className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Cursor IDE Setup
                </h3>
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-xs space-y-3">
                  <ol className="list-decimal pl-5 space-y-1.5 text-slate-600 dark:text-slate-400">
                    <li>Open Cursor and navigate to <strong>Settings → Features → MCP</strong>.</li>
                    <li>Click <strong>&quot;+ Add New MCP Server&quot;</strong>.</li>
                    <li>
                      Configure the server:
                      <ul className="list-disc pl-5 mt-1 space-y-1 text-slate-500 dark:text-slate-400">
                        <li><strong>Name:</strong> <code className="font-mono">github-notes</code></li>
                        <li><strong>Type:</strong> select <code className="font-mono">sse</code></li>
                        <li><strong>Server URL:</strong> paste the connection URL below</li>
                      </ul>
                    </li>
                  </ol>
                  <div className="relative flex items-center gap-2 bg-slate-900 text-slate-100 p-2.5 rounded-lg font-mono text-[11px] mt-2">
                    <code className="flex-1 break-all select-all">{displayUrl}</code>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(displayUrl, 'cursor-url')}
                      className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-xs transition shrink-0 flex items-center gap-1"
                    >
                      {copiedKey === 'cursor-url' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedKey === 'cursor-url' ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Windsurf or Other MCP Clients
                </h3>
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-xs space-y-2">
                  <p className="text-slate-600 dark:text-slate-400">
                    In Windsurf configuration file <code className="font-mono bg-black/5 dark:bg-white/10 px-1 py-0.5 rounded">~/.codeium/windsurf/mcp_config.json</code>, paste the same JSON configuration.
                  </p>
                </div>
              </div>

              {/* Security & Access Info */}
              <div className="p-3.5 bg-slate-100 dark:bg-slate-800/70 rounded-xl text-xs space-y-2 border border-slate-200 dark:border-slate-700">
                <h4 className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <HelpCircle className="w-3.5 h-3.5 text-indigo-500" />
                  Permissions & Security Information
                </h4>
                <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-400 text-[11px]">
                  <li><strong>Read-only:</strong> The AI client can only list, read, and search notes and notebooks. It cannot modify or delete any files.</li>
                  <li><strong>Read and write:</strong> The AI client can create, update, or remove notes during conversations. Every mutation is an atomic Git commit with full revision history.</li>
                  <li><strong>Revocation:</strong> You can revoke grants anytime in MCP Access Control settings. The URL will stop working immediately.</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <span className="text-xs text-slate-400">
            Standard Model Context Protocol (Streamable HTTP / SSE)
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 text-white dark:text-slate-900 rounded-lg text-xs font-medium transition active:scale-95 shadow-sm"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
