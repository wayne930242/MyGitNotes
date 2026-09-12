const repository = process.env.GITHUB_REPOSITORY;
const sha = process.env.MAIN_SHA;
if (!repository || !/^[a-f0-9]{40}$/.test(sha || '') || !process.env.GH_TOKEN) throw Error('Repository, main SHA and GitHub token are required.');
for (let attempt = 0; attempt < 90; attempt++) {
  const response = await fetch(`https://api.github.com/repos/${repository}/commits/${sha}/status`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw Error(`GitHub status request failed: ${response.status}`);
  const { statuses } = await response.json();
  const status = statuses.find(status => status.context === 'Vercel' || status.context.startsWith('Vercel'));
  if (status?.state === 'success') { console.log(`Vercel deployed main ${sha}: ${status.target_url}`); process.exit(0); }
  if (status && ['failure', 'error'].includes(status.state)) throw Error(`Vercel deployment failed: ${status.target_url}`);
  await new Promise(resolve => setTimeout(resolve, 10000));
}
throw Error(`Timed out waiting for Vercel deployment of main ${sha}.`);
