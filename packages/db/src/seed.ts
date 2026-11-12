/**
 * Bootstrap seed. Intentionally creates NO users, organizations, projects or
 * scan data: the product rule is no fabricated data. Reference data (roles,
 * statuses) lives in Postgres enums created by migrations. This script only
 * verifies the bootstrap prerequisites so a fresh environment fails loudly.
 */
import { sql } from 'drizzle-orm';
import { createDb } from './client.js';

const url = process.env['DATABASE_URL'];
if (!url) {
  process.stderr.write('DATABASE_URL is required\n');
  process.exit(1);
}
const handle = createDb(url, { max: 1 });
try {
  const res = await handle.db.execute(
    sql`select unnest(enum_range(null::member_role))::text as role`,
  );
  const roles = res.rows.map((r) => String(r['role']));
  const expected = ['owner', 'admin', 'member', 'viewer'];
  const missing = expected.filter((r) => !roles.includes(r));
  if (missing.length > 0) throw new Error(`missing roles: ${missing.join(', ')}`);
  process.stdout.write(`bootstrap ok; roles: ${roles.join(', ')}\n`);
} finally {
  await handle.close();
}
