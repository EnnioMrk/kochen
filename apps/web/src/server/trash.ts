import { db } from "@rezeptor/db";
import { deleteObject } from "./media";

/** A deleted recipe stays restorable for this many days. */
export const TRASH_RETENTION_DAYS = 7;

const PURGE_INTERVAL_MS = 60 * 60 * 1000;
let lastPurge = 0;

/**
 * Hard-delete recipes whose retention has expired, with their images.
 * Runs at most once an hour per server process.
 */
export async function purgeExpiredRecipes(): Promise<number> {
  if (Date.now() - lastPurge < PURGE_INTERVAL_MS) return 0;
  const sql = db();
  const expired = await sql<{ id: string }[]>`
    select id from recipes
    where deleted_at is not null
      and deleted_at < now() - make_interval(days => ${TRASH_RETENTION_DAYS})
  `;
  if (expired.length === 0) {
    lastPurge = Date.now();
    return 0;
  }

  const ids = expired.map((row) => row.id);
  const keys = await sql<{ key: string }[]>`
    select r2_key as key from images where recipe_id = any(${ids}::uuid[])
  `;
  await sql`delete from recipes where id = any(${ids}::uuid[])`;
  await Promise.allSettled(keys.map((row) => deleteObject(row.key)));
  lastPurge = Date.now();
  return ids.length;
}
