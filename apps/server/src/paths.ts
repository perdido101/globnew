import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** apps/server */
export const SERVER_ROOT = path.resolve(here, '..');
/** repository root */
export const REPO_ROOT = path.resolve(SERVER_ROOT, '../..');

export function fromServerRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.join(SERVER_ROOT, p);
}
