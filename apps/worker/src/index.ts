import { closeDb } from "@kochen/db";
import { env, logger } from "./config";
import { runExportPdfJob } from "./jobs/export-pdf";
import { runImportJob } from "./jobs/import";
import { runPushJob } from "./jobs/push";
import { runTimerJob } from "./jobs/timer";
import { claimNextJob, failJob, type JobRow } from "./queue";

let stopping = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dispatch(job: JobRow): Promise<void> {
  if (job.kind.startsWith("import_")) {
    await runImportJob(job);
    return;
  }
  switch (job.kind) {
    case "export_pdf":
      await runExportPdfJob(job);
      return;
    case "timer":
      await runTimerJob(job);
      return;
    case "push":
      await runPushJob(job);
      return;
    default:
      await failJob(job, "internal", "Dieser Auftragstyp wird nicht unterstützt.", false);
  }
}

async function main(): Promise<void> {
  logger.info({ node: process.version, pollMs: env.workerPollMs }, "worker_started");

  if (!process.env.DATABASE_URL) {
    logger.error("DATABASE_URL is not set; the worker cannot claim jobs");
    process.exitCode = 1;
    return;
  }
  if (!env.r2Configured) {
    logger.warn("R2 is not configured; media jobs will fail");
  }
  if (!env.vapidConfigured) {
    logger.warn("VAPID keys are not configured; push jobs are skipped");
  }
  if (!env.aiConfigured) {
    logger.warn({ provider: env.aiProvider }, "No AI key is configured; import jobs will fail with ai_unavailable");
  }

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      if (stopping) {
        logger.warn({ signal }, "worker_force_stop");
        process.exit(1);
      }
      stopping = true;
      logger.info({ signal }, "worker_stopping");
    });
  }

  process.on("unhandledRejection", (reason) => {
    logger.error(
      { err: reason instanceof Error ? reason.message : String(reason) },
      "unhandled_rejection",
    );
  });

  while (!stopping) {
    let job: JobRow | null = null;
    try {
      job = await claimNextJob();
    } catch (error) {
      logger.error({ err: error instanceof Error ? error.message : String(error) }, "claim_failed");
      await sleep(env.workerPollMs);
      continue;
    }

    if (!job) {
      await sleep(env.workerPollMs);
      continue;
    }

    const startedAt = Date.now();
    logger.info({ jobId: job.id, kind: job.kind, attempt: job.attempts }, "job_started");
    try {
      await dispatch(job);
    } catch (error) {
      // Handlers own their failure state; this is the last line of defense.
      logger.error(
        { jobId: job.id, kind: job.kind, err: error instanceof Error ? error.message : String(error) },
        "job_crashed",
      );
      await failJob(
        job,
        "internal",
        "Beim Verarbeiten ist ein unerwarteter Fehler aufgetreten.",
        true,
      ).catch(() => {});
    }
    logger.info({ jobId: job.id, kind: job.kind, durationMs: Date.now() - startedAt }, "job_done");
  }

  await closeDb().catch(() => {});
  logger.info("worker_stopped");
}

void main().catch((error) => {
  logger.fatal({ err: error instanceof Error ? error.message : String(error) }, "worker_fatal");
  process.exit(1);
});
