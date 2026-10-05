// Loaded into the bridged Pi with `--extension`. Pi decides project trust itself (an extension's project_trust
// handler, then ~/.pi/agent/trust.json, then defaultProjectTrust), and RPC has no command that reports the
// result, so this reports it as a status line the bridge reads into the session info instead of showing it.
export const TRUST_STATUS_KEY = 'mygitnotes-project-trust';

export default function reportProjectTrust(pi) {
  pi.on('session_start', (_event, ctx) => {
    ctx.ui.setStatus(TRUST_STATUS_KEY, ctx.isProjectTrusted() ? 'trusted' : 'untrusted');
  });
}
