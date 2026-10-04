/** Outline notes use ordinary Markdown; the filename is their only type discriminator. */
export const OUTLINE_SUFFIX = '.outline.md';
export const isOutlinePath = (file: string): boolean => file.endsWith(OUTLINE_SUFFIX);
