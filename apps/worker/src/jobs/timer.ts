import { db, tx } from "@kochen/db";
import { logger } from "../config";
import { failJob, finishJob, type JobRow } from "../queue";

type TimerRow = {
  id: string;
  userId: string;
  recipeId: string;
  stepId: string;
  endsAt: Date;
  notifiedAt: Date | null;
};

/**
 * A timer fires once. The notification insert and `notified_at` update run in
 * one transaction; the unique dedupe key covers a repeated job.
 */
export async function runTimerJob(job: JobRow): Promise<void> {
  try {
    const timerId = typeof job.payload.timerId === "string" ? job.payload.timerId : null;
    if (!timerId) {
      await finishJob(job.id, "done");
      return;
    }

    const sql = db();
    const rows = await sql<TimerRow[]>`
      select id, user_id as "userId", recipe_id as "recipeId", step_id as "stepId",
             ends_at as "endsAt", notified_at as "notifiedAt"
      from timers where id = ${timerId}
    `;
    const timer = rows[0];
    if (!timer) {
      // The timer was cancelled; a stale job is not an error.
      await finishJob(job.id, "done");
      return;
    }
    if (timer.notifiedAt) {
      await finishJob(job.id, "done");
      return;
    }

    await tx(async (transaction) => {
      const updated = await transaction<{ id: string }[]>`
        update timers set notified_at = now()
        where id = ${timer.id} and notified_at is null
        returning id
      `;
      if (!updated[0]) return;

      await transaction`
        insert into notifications (user_id, kind, payload, dedupe_key)
        values (${timer.userId}, 'timer',
                ${transaction.json({ recipeId: timer.recipeId, stepId: timer.stepId } as never)},
                ${`timer:${timer.id}`})
        on conflict do nothing
      `;

      const setting = await transaction<{ value: boolean }[]>`
        select coalesce((value->>'push')::boolean, true) as value
        from app_settings where key = ${`user:${timer.userId}`}
      `;
      if (setting[0]?.value ?? true) {
        await transaction`
          insert into jobs (user_id, kind, payload, state)
          values (${timer.userId}, 'push',
                  ${transaction.json({
                    notification: {
                      kind: "timer",
                      payload: { recipeId: timer.recipeId, stepId: timer.stepId },
                    },
                  } as never)}, 'queued')
        `;
      }
    });

    await finishJob(job.id, "done");
    logger.info({ jobId: job.id, timerId }, "timer_notified");
  } catch (error) {
    logger.error({ jobId: job.id, err: error instanceof Error ? error.message : String(error) }, "timer_failed");
    await failJob(job, "internal", "Der Timer konnte nicht benachrichtigt werden.", true);
  }
}
