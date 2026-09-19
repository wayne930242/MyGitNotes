export function noteFolder(notePath: string, notebookRoot: string): string {
  const prefix = notebookRoot.replace(/\/$/, '') + '/';
  if (!notePath.startsWith(prefix)) return '';
  const relative = notePath.slice(prefix.length);
  return relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : '';
}
export function inFolder(notePath: string, root: string, folder: string | null) {
  const current = noteFolder(notePath, root);
  return folder === null || current === folder || current.startsWith(`${folder}/`);
}
export function relativeAsset(notePath: string, assetPath: string): string {
  const from = notePath.split('/').slice(0, -1);
  const to = assetPath.split('/');
  while (from.length && to.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return [...from.map(() => '..'), ...to].map(p => p === '..' ? p : encodeURIComponent(p)).join('/');
}
