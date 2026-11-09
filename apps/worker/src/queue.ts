import { db } from "@kochen/db";
import { logger } from "./config";
import { isRetryableCode } from "./errors";

export type JobRow = {
  id: string;
  userId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  state: string;
};

export const MAX_ATTEMPTS = 3;
const STALE_LOCK_MINUTES = 60;

/**
 * Atomically claim one runnable job. `FOR UPDATE SKIP LOCKED` makes two
 * workers race safely; the update stamps `locked_at` and counts the attempt.
 */
export async function claimNextJob(): Promise<JobRow | null> {
  const sql = db();
  const rows = await sql<JobRow[]>`
    update jobs
    set locked_at = now(),
        attempts = attempts + 1,
        updated_at = now()
    where id = (
      select id from jobs
      where state in ('queued', 'fetching', 'normalizing', 'understanding')
        and run_at <= now()
        and (locked_at is null or locked_at < now() - make_interval(mins => ${STALE_LOCK_MINUTES}))
      order by run_at, created_at
      limit 1
      for update skip locked
    )
    returning id, user_id as "userId", kind, payload, attempts, state
  `;
  return rows[0] ?? null;
}

/** Write a state transition. Progress is a 0..100 hint for the UI. */
export async function setState(
  jobId: string,
  state: string,
  progress?: number,
  payloadPatch?: Record<string, unknown>,
): Promise<void> {
  const sql = db();
  if (payloadPatch && Object.keys(payloadPatch).length > 0) {
    await sql`
      update jobs
      set state = ${state},
          progress = coalesce(${progress ?? null}, progress),
          payload = payload || ${sql.json(payloadPatch as never)},
          error_code = null,
          last_error = null,
          locked_at = now(),
          updated_at = now()
      where id = ${jobId}
    `;
    return;
  }
  await sql`
    update jobs
    set state = ${state},
        progress = coalesce(${progress ?? null}, progress),
        error_code = null,
        last_error = null,
        locked_at = now(),
        updated_at = now()
    where id = ${jobId}
  `;
}

/** Finish a job. The payload patch merges into the existing JSONB object. */
export async function finishJob(
  jobId: string,
  state: "needs_review" | "done" = "done",
  payloadPatch?: Record<string, unknown>,
): Promise<void> {
  const sql = db();
  if (payloadPatch && Object.keys(payloadPatch).length > 0) {
    await sql`
      update jobs
      set state = ${state},
          progress = 100,
          payload = payload || ${sql.json(payloadPatch as never)},
          error_code = null,
          last_error = null,
          locked_at = null,
          updated_at = now()
      where id = ${jobId}
    `;
    return;
  }
  await sql`
    update jobs
    set state = ${state},
        progress = 100,
        error_code = null,
        last_error = null,
        locked_at = null,
        updated_at = now()
    where id = ${jobId}
  `;
}

/**
 * Mark a job failed, or put it back in the queue with linear backoff
 * (attempt × 30 s) while attempts remain.
 */
export async function failJob(
  job: JobRow,
  code: string,
  message: string,
  retryable = isRetryableCode(code),
): Promise<"retry" | "failed"> {
  const sql = db();
  if (retryable && job.attempts < MAX_ATTEMPTS) {
    const delaySeconds = job.attempts * 30;
    await sql`
      update jobs
      set state = 'queued',
          run_at = now() + make_interval(secs => ${delaySeconds}),
          locked_at = null,
          error_code = ${code},
          last_error = ${message},
          updated_at = now()
      where id = ${job.id}
    `;
    logger.warn({ jobId: job.id, kind: job.kind, attempt: job.attempts, delaySeconds, code }, "job_retry");
    return "retry";
  }
  await sql`
    update jobs
    set state = 'failed',
        error_code = ${code},
        last_error = ${message},
        locked_at = null,
        updated_at = now()
    where id = ${job.id}
  `;
  logger.error({ jobId: job.id, kind: job.kind, attempt: job.attempts, code }, "job_failed");
  return "failed";
}

/** Give a claimed job back without marking it failed. */
export async function releaseJob(jobId: string): Promise<void> {
  const sql = db();
  await sql`
    update jobs
    set state = 'queued',
        run_at = now(),
        locked_at = null,
        updated_at = now()
    where id = ${jobId} and state not in ('done', 'failed', 'needs_review')
  `;
}
