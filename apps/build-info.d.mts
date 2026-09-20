export interface BuildInfo {
  version: string;
  sha: string;
  released: boolean;
}
export const productRoot: string;
export function readBuildInfo(options?: { root?: string; env?: NodeJS.ProcessEnv }): BuildInfo;
