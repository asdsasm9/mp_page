// Real filesystem for the backup core (the CLI passes this; tests pass an in-memory fake).
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { BackupFs } from './masters';

export const nodeFs: BackupFs = {
  async mkdir(path) {
    await mkdir(path, { recursive: true });
  },
  async readFile(path) {
    try {
      return new Uint8Array(await readFile(path));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  },
  writeFile: (path, data) => writeFile(path, data),
  rename: (from, to) => rename(from, to),
  rm: (path) => rm(path, { force: true }),
};
