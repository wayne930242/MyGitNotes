export function linePrompt(path: string, firstLine: number, lastLine = firstLine): string {
  const start = Math.min(firstLine, lastLine);
  const end = Math.max(firstLine, lastLine);
  return start === end ? `Regarding line ${start} of \`${path}\`: ` : `Regarding lines ${start}-${end} of \`${path}\`: `;
}

export async function copyLinePrompt(path: string, firstLine: number, lastLine = firstLine): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(linePrompt(path, firstLine, lastLine));
    return true;
  } catch {
    return false;
  }
}
