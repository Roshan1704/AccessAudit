import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { createDb } from './client.js';

const url = process.env['MIGRATION_DATABASE_URL'];
if (!url) {
  process.stderr.write('MIGRATION_DATABASE_URL (aa_migrator) is required\n');
  process.exit(1);
}
const handle = createDb(url, { max: 1 });
try {
  await migrate(handle.db, {
    migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
  });
  process.stdout.write('migrations applied\n');
} finally {
  await handle.close();
}
