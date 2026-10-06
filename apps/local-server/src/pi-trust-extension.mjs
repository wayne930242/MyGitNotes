// Loaded into the bridged Pi with `--extension`. Pi decides project trust itself (an extension's project_trust
// handler, then ~/.pi/agent/trust.json, then defaultProjectTrust), and RPC has no command that reports the
// result, so this reports it as a status line the bridge reads into the session info instead of showing it.
// It also relays pi-mcp-adapter's MCP server snapshot the same way, so the panel can list the servers.
// /reload is a TUI built-in that RPC mode lacks, so this registers it as an extension command the panel can send.
export const TRUST_STATUS_KEY = 'mygitnotes-project-trust';
export const MCP_STATUS_KEY = 'mygitnotes-mcp-servers';
/** pi-mcp-adapter's versioned status event; its snapshot is sanitized and never connects to a server. */
const MCP_STATUS_EVENT = 'pi-mcp-adapter/status/v1';

export default function reportProjectTrust(pi) {
  let ui;
  let mcpServers;
  const reportMcp = () => ui && mcpServers && ui.setStatus(MCP_STATUS_KEY, JSON.stringify(mcpServers));
  pi.events.on(MCP_STATUS_EVENT, snapshot => {
    if (!Array.isArray(snapshot?.servers)) return;
    mcpServers = snapshot.servers.map(({ name, status, toolCount, blockedReason }) => ({ name, status, toolCount, ...(blockedReason ? { blockedReason } : {}) }));
    reportMcp();
  });
  pi.on('session_start', (event, ctx) => {
    ui = ctx.ui;
    ui.setStatus(TRUST_STATUS_KEY, ctx.isProjectTrusted() ? 'trusted' : 'untrusted');
    reportMcp();
    // The reload replaced this runtime, so the new one confirms it; the old context is gone by then.
    if (event?.reason === 'reload') ui.notify('Reloaded extensions, skills, prompt templates, settings and context files.', 'info');
  });
  pi.registerCommand('reload', {
    description: 'Reload extensions, skills, prompt templates, settings and context files',
    handler: async (_args, ctx) => {
      // A reload mid-run would swap the tools out from under it, so it waits for the run to end.
      await ctx.waitForIdle();
      await ctx.reload();
    },
  });
}
