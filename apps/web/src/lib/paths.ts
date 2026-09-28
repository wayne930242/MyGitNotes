/** Parent of a slash-separated repository path; empty for a top-level name. */
export const parentPath = (file: string) => file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';

/** Last segment of a slash-separated repository path. */
export const baseName = (file: string) => file.slice(file.lastIndexOf('/') + 1);
