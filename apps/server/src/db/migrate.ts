import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { SERVER_ROOT } from '../paths.js';
import { db, sql } from './client.js';

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: path.join(SERVER_ROOT, 'drizzle') });
}

// CLI: `pnpm db:migrate`
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  runMigrations()
    .then(() => {
      console.log('migrations applied');
      return sql.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
