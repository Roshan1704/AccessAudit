import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function createDb(connectionString: string, opts: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({ connectionString, max: opts.max ?? 10 });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TenantScope {
  orgId?: string | undefined;
  userId?: string | undefined;
}

/**
 * Runs `fn` in a transaction with row-level-security context set via SET LOCAL
 * (transaction scoped, so it can never leak across pooled connections).
 * Values are validated as UUIDs before being used.
 */
export async function withTenant<T>(
  db: Db,
  scope: TenantScope,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  for (const v of [scope.orgId, scope.userId]) {
    if (v !== undefined && !UUID_RE.test(v)) throw new Error('withTenant: invalid uuid');
  }
  return db.transaction(async (tx) => {
    // set_config(..., is_local=true) == SET LOCAL, but parameterisable.
    await tx.execute(sql`select set_config('app.org_id', ${scope.orgId ?? ''}, true)`);
    await tx.execute(sql`select set_config('app.user_id', ${scope.userId ?? ''}, true)`);
    return fn(tx);
  });
}
