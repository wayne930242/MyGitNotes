import type { FileCommand } from '@mygitnotes/core';
import type { I18nContextValue } from '../../lib/i18n/index.js';

interface FileUploadOptions {
  prepareLeave: () => Promise<boolean>;
  run: (action: () => Promise<void>) => Promise<boolean>;
  apply: (command: FileCommand) => Promise<void>;
  t: I18nContextValue['t'];
  notebookId: string;
  directory: string;
}

export function createFileUpload({ prepareLeave, run, apply, t, notebookId, directory }: FileUploadOptions) {
  const upload = async (file?: globalThis.File) => {
    if (!file || !await prepareLeave()) return;
    await run(async () => {
      if (file.size > 3 * 1024 * 1024) throw new Error(t('files.uploadLimit'));
      const encoded = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      await apply({ kind: 'upload', notebookId, path: directory + '/' + file.name, base64: encoded });
    });
  };
  return upload;
}
