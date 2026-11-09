import type { postgres } from "@kochen/db";

type Tx = postgres.TransactionSql<Record<string, unknown>>;

export type NotifyKind =
  | "comment"
  | "reply"
  | "friend_request"
  | "friend_accepted"
  | "variation"
  | "timer";

/**
 * One row per event and person. `dedupeKey` makes delivery idempotent.
 * Push is only a hint; the bell list is the record.
 */
export async function notify(
  sql: Tx,
  userId: string,
  kind: NotifyKind,
  payload: Record<string, unknown>,
  dedupeKey?: string,
): Promise<void> {
  await sql`
    insert into notifications (user_id, kind, payload, dedupe_key)
    values (${userId}, ${kind}, ${sql.json(payload as never)}, ${dedupeKey ?? null})
    on conflict do nothing
  `;
  const setting = await sql<{ value: boolean }[]>`
    select coalesce((value->>'push')::boolean, true) as value
    from app_settings where key = ${`user:${userId}`}
  `;
  const pushEnabled = setting[0]?.value ?? true;
  if (!pushEnabled) return;
  await sql`
    insert into jobs (user_id, kind, payload, state)
    values (${userId}, 'push', ${sql.json({ notification: { kind, payload } } as never)}, 'queued')
  `;
}
