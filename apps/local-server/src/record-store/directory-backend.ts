import fs from 'node:fs/promises';
import path from 'node:path';
import type { RecordBackend } from './record-store.js';
import { random } from './sealing.js';

/** Records as files in `.github-notes-sessions` under the application root, for self-hosting outside Vercel. */
export class DirectoryRecordBackend implements RecordBackend {
  readonly scope: string;
  private readonly dir: string;
  constructor(base: string) {
    this.dir = path.join(base, '.github-notes-sessions');
    this.scope = `directory:${this.dir}`;
  }
  async put(hash: string, sealed: string) {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    // A reader hitting a half-written file would see a valid credential as missing, so the record
    // lands through a rename: concurrent readers get either the previous record or the new one.
    const target = path.join(this.dir, hash), pending = `${target}.${random()}.tmp`;
    try {
      await fs.writeFile(pending, sealed, { mode: 0o600 });
      await fs.rename(pending, target);
    } catch (error) {
      await fs.rm(pending, { force: true });
      throw error;
    }
  }
  async fetch(hash: string) {
    try {
      return await fs.readFile(path.join(this.dir, hash), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async remove(hash: string) {
    await fs.rm(path.join(this.dir, hash), { force: true });
  }
  async grantCandidates() {
    try {
      // Only sealed records are named after a digest; a record still being written is not one yet.
      return (await fs.readdir(this.dir)).filter(name => /^[a-f0-9]{64}$/.test(name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  // Listing reads every record, so there is no grant index to maintain.
  async addGrant() {}
  async forgetGrant() {}
  // One server owns the directory; the in-process queue already serializes its refreshes.
  async lockAcrossInstances() {
    return null;
  }
}
