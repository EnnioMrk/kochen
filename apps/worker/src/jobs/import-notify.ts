import { tx } from "@rezeptor/db";
import { logger } from "../config";
import type { JobRow } from "../queue";

/**
 * The capture may finish long after the member closed the app. Record it in
 * the bell list and queue a push, so the result is not missed. A notification
 * failure must never undo a finished import.
 */
export async function notifyImportReady(job: JobRow, title: string | null): Promise<void> {
  if (!job.userId) return;
  const payload = { jobId: job.id, title: title ?? null };
  try {
    await tx(async (sql) => {
      await sql`
        insert into notifications (user_id, kind, payload, dedupe_key)
        values (${job.userId}, 'import_ready',
                ${sql.json(payload as never)}, ${`import:${job.id}`})
        on conflict do nothing
      `;
      const setting = await sql<{ value: boolean }[]>`
        select coalesce((value->>'push')::boolean, true) as value
        from app_settings where key = ${`user:${job.userId}`}
      `;
      if (!(setting[0]?.value ?? true)) return;
      await sql`
        insert into jobs (user_id, kind, payload, state)
        values (${job.userId}, 'push',
                ${sql.json({ notification: { kind: "import_ready", payload } } as never)}, 'queued')
      `;
    });
  } catch (error) {
    logger.warn(
      { jobId: job.id, err: error instanceof Error ? error.message : String(error) },
      "import_notify_failed",
    );
  }
}
