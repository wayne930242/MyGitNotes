import React, { useState } from 'react';
import { X, Copy, Check, ExternalLink, Bot, Terminal, Code2, Sparkles, AlertCircle, HelpCircle } from 'lucide-react';

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
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // Fallback if clipboard API is restricted
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
                MCP 連接器設定教學指南
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                將 GitHub Notes 筆記庫連接至 ChatGPT、Claude 或各類 AI 編輯器
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
                ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-300 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Bot className="w-4 h-4" />
            <span>ChatGPT 連接器</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('claude')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition -mb-px whitespace-nowrap ${
              activeTab === 'claude'
                ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-300 font-semibold'
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
                ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-300 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Code2 className="w-4 h-4" />
            <span>通用 MCP (Cursor / Windsurf)</span>
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Active URL notice if available */}
          {activeUrl && (
            <div className="p-3.5 bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/80 rounded-xl text-xs flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  已為您帶入當前產生的 MCP 連線網址
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(activeUrl, 'active-url')}
                  className="flex items-center gap-1 px-2.5 py-1 bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-300 rounded-md border border-indigo-200 dark:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-slate-700 transition font-medium"
                >
                  {copiedKey === 'active-url' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey === 'active-url' ? '已複製' : '複製連線網址'}</span>
                </button>
              </div>
              <code className="text-[11px] font-mono bg-white dark:bg-slate-900 p-2 rounded border border-indigo-100 dark:border-indigo-900 break-all select-all text-slate-700 dark:text-slate-300">
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
                  <span className="font-semibold">使用需求：</span>
                  ChatGPT 新增自訂連接器功能需要 Plus、Pro、Team、Business 或 Edu 帳號，並在設定中開啟開發者模式。
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  設定步驟
                </h3>

                {/* Step 1 */}
                <div className="flex gap-3.5 items-start p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                  <span className="w-6 h-6 rounded-full bg-indigo-600 dark:bg-indigo-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
                    1
                  </span>
                  <div className="flex-1 text-xs">
                    <p className="font-semibold text-slate-800 dark:text-slate-200">
                      開啟 ChatGPT 連接器設定並啟用開發者模式
                    </p>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                      前往 ChatGPT 的「設定 (Settings)」→「連接器 (Connectors)」分頁，開啟「開發者模式 (Developer Mode)」開關，然後按下「建立應用程式 (Create Application)」按鈕。
                    </p>
                    <a
                      href="https://chatgpt.com/#settings/Connectors"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-2 text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                    >
                      開啟 ChatGPT 連接器設定頁面 <ExternalLink className="w-3 h-3" />
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
                      填寫應用程式名稱與 MCP 伺服器網址
                    </p>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                      名稱填寫：<code className="font-mono bg-black/5 dark:bg-white/10 px-1 py-0.5 rounded">GitHub Notes</code>。在伺服器網址 (Server URL) 欄位中，貼上下方的 MCP 連線網址：
                    </p>
                    <div className="relative mt-2 flex items-center gap-2 bg-slate-900 text-slate-100 p-2.5 rounded-lg font-mono text-[11px]">
                      <code className="flex-1 break-all select-all">{displayUrl}</code>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(displayUrl, 'chatgpt-url')}
                        className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-xs transition shrink-0 flex items-center gap-1"
                      >
                        {copiedKey === 'chatgpt-url' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedKey === 'chatgpt-url' ? '已複製' : '複製'}</span>
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
                      身份驗證選擇「無身份驗證 (No authentication)」
                    </p>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                      重要：在「身份驗證 (Authentication)」下拉選單中選擇<strong>「無 (No authentication)」</strong>。因為 GitHub Notes 連線 URL 中已包含專屬授權憑證，網址本身即可提供安全的存取控制。
                    </p>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                      勾選使用者條款同意核取方塊後，按下<strong>「建立 (Create)」</strong>完成註冊。
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
                      在對話中啟用應用程式並開始互動
                    </p>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                      在 ChatGPT 對話輸入框點擊「+」號（或應用程式清單），選擇「GitHub Notes」，即可讓 ChatGPT 讀取、搜尋或更新你的筆記！
                    </p>
                  </div>
                </div>
              </div>

              {/* Sample Prompts */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  試試這些範例提示詞 (點擊直接複製)
                </h4>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    '列出我在 GitHub Notes 中的所有筆記與標籤結構',
                    '搜尋筆記庫中有關「架構設計」或「API」的內容並彙總給我',
                    '在 ideas 筆記本中建立一篇標題為「2026 產品規劃」的新筆記',
                  ].map((prompt, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => copyToClipboard(prompt, `prompt-${idx}`)}
                      className="w-full flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700 bg-white dark:bg-slate-900/80 text-left text-xs text-slate-700 dark:text-slate-300 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20 transition group"
                    >
                      <span className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        <span>{prompt}</span>
                      </span>
                      <span className="text-[11px] text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 flex items-center gap-1 shrink-0">
                        {copiedKey === `prompt-${idx}` ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedKey === `prompt-${idx}` ? '已複製' : '複製'}</span>
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
                  選項 A：Claude Desktop 桌面端設定
                </h3>
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-xs space-y-3">
                  <p className="text-slate-600 dark:text-slate-400">
                    開啟 Claude Desktop 設定檔 <code className="font-mono bg-black/5 dark:bg-white/10 px-1 py-0.5 rounded">claude_desktop_config.json</code>：
                  </p>
                  <ul className="list-disc pl-5 space-y-1 text-slate-500 dark:text-slate-400 text-[11px]">
                    <li><strong>macOS:</strong> <code className="font-mono">~/Library/Application Support/Claude/claude_desktop_config.json</code></li>
                    <li><strong>Windows:</strong> <code className="font-mono">%APPDATA%\Claude\claude_desktop_config.json</code></li>
                    <li><strong>Linux:</strong> <code className="font-mono">~/.config/Claude/claude_desktop_config.json</code></li>
                  </ul>

                  <div className="pt-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        將設定加入 mcpServers（遠端 / HTTP SSE 模式）：
                      </span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(claudeDesktopConfig, 'claude-desktop-cfg')}
                        className="flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        {copiedKey === 'claude-desktop-cfg' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedKey === 'claude-desktop-cfg' ? '已複製' : '複製 JSON'}</span>
                      </button>
                    </div>
                    <pre className="p-3 rounded-lg bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto">
                      {claudeDesktopConfig}
                    </pre>
                  </div>

                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        或使用本機 Stdio 模式（直接執行本機 CLI）：
                      </span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(claudeLocalStdioConfig, 'claude-stdio-cfg')}
                        className="flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        {copiedKey === 'claude-stdio-cfg' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedKey === 'claude-stdio-cfg' ? '已複製' : '複製 JSON'}</span>
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
                  選項 B：Claude Code (CLI 命令列)
                </h3>
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-xs space-y-2">
                  <p className="text-slate-600 dark:text-slate-400">
                    在終端機中執行以下指令，直接將 GitHub Notes 註冊至 Claude Code：
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
                      <span>{copiedKey === 'claude-cli' ? '已複製' : '複製'}</span>
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
                  Cursor IDE 設定
                </h3>
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-xs space-y-3">
                  <ol className="list-decimal pl-5 space-y-1.5 text-slate-600 dark:text-slate-400">
                    <li>開啟 Cursor，前往 <strong>Settings → Features → MCP</strong>。</li>
                    <li>點擊 <strong>「+ Add New MCP Server」</strong>。</li>
                    <li>
                      填寫設定值：
                      <ul className="list-disc pl-5 mt-1 space-y-1 text-slate-500 dark:text-slate-400">
                        <li><strong>Name:</strong> <code className="font-mono">github-notes</code></li>
                        <li><strong>Type:</strong> 選擇 <code className="font-mono">sse</code></li>
                        <li><strong>Server URL:</strong> 貼上連線網址（見下方）</li>
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
                      <span>{copiedKey === 'cursor-url' ? '已複製' : '複製'}</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Windsurf 或其他 MCP 客戶端
                </h3>
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-xs space-y-2">
                  <p className="text-slate-600 dark:text-slate-400">
                    在 Windsurf 的配置檔 <code className="font-mono bg-black/5 dark:bg-white/10 px-1 py-0.5 rounded">~/.codeium/windsurf/mcp_config.json</code> 中貼入相同 JSON 設定即可。
                  </p>
                </div>
              </div>

              {/* Security & Access Info */}
              <div className="p-3.5 bg-slate-100 dark:bg-slate-800/70 rounded-xl text-xs space-y-2 border border-slate-200 dark:border-slate-700">
                <h4 className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <HelpCircle className="w-3.5 h-3.5 text-indigo-500" />
                  權限與安全性說明
                </h4>
                <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-400 text-[11px]">
                  <li><strong>唯讀 (Read-only)：</strong> AI 客戶端僅能列出與閱讀筆記、目錄結構及搜尋，無法修改或刪除任何檔案。</li>
                  <li><strong>讀寫 (Read and write)：</strong> AI 客戶端可由對話中自動建立、編輯或刪除筆記。每次變更皆為標準且原子性的 Git Commit，保證隨時可版本回溯。</li>
                  <li><strong>授權吊銷 (Revoke)：</strong> 隨時可在 MCP Access Control 清單中點選「Revoke」，連線將立即失效。</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <span className="text-xs text-slate-400">
            遵循標準 Model Context Protocol (Streamable HTTP / SSE) 規範
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 text-white dark:text-slate-900 rounded-lg text-xs font-medium transition active:scale-95 shadow-sm"
          >
            完成並關閉
          </button>
        </div>
      </div>
    </div>
  );
};
