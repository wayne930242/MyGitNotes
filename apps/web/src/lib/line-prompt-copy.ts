/** The prompt a reader pastes into an agent: the quoted lines themselves, under a header naming their real location. */
export function linePrompt(path: string, firstLine: number, lastLine: number, text: string): string {
  const start = Math.min(firstLine, lastLine);
  const end = Math.max(firstLine, lastLine);
  const header = start === end ? `Below is line ${start} of \`${path}\`:` : `Below are lines ${start}-${end} of \`${path}\`:`;
  return `${header}\n\n${text}\n`;
}

export async function copyLinePrompt(path: string, firstLine: number, lastLine: number, text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(linePrompt(path, firstLine, lastLine, text));
    return true;
  } catch {
    return false;
  }
}
