import { db } from "@kochen/db";
import webpush from "web-push";
import { env, logger } from "../config";
import { failJob, finishJob, type JobRow } from "../queue";

type SubscriptionRow = {
  id: string;
  endpoint: string;
  keys: unknown;
};

type PushKeys = { p256dh: string; auth: string };

type PushText = { title: string; body: string; url: string; tag: string };

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function parseKeys(value: unknown): PushKeys | null {
  if (!value || typeof value !== "object") return null;
  const keys = value as Record<string, unknown>;
  if (typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return null;
  return { p256dh: keys.p256dh, auth: keys.auth };
}

/** German push copy and deep links, one mapping for every notification kind. */
export function pushText(kind: string, payload: Record<string, unknown>): PushText {
  const recipeId = asString(payload.recipeId);
  const recipeTitle = asString(payload.recipeTitle) ?? asString(payload.title) ?? "dein Rezept";
  const from = asString(payload.from) ?? "Jemand";
  const recipeUrl = recipeId ? `${env.appOrigin}/rezept/${recipeId}` : `${env.appOrigin}/`;

  switch (kind) {
    case "comment":
      return {
        title: "Neuer Kommentar",
        body: `${from} hat „${recipeTitle}“ kommentiert.`,
        url: recipeUrl,
        tag: recipeId ? `comment:${recipeId}` : "comment",
      };
    case "reply":
      return {
        title: "Neue Antwort",
        body: `${from} hat auf deinen Kommentar geantwortet.`,
        url: recipeUrl,
        tag: recipeId ? `reply:${recipeId}` : "reply",
      };
    case "friend_request":
      return {
        title: "Neue Freundschaftsanfrage",
        body: `${from} möchte mit dir befreundet sein.`,
        url: `${env.appOrigin}/freunde`,
        tag: "friend_request",
      };
    case "friend_accepted":
      return {
        title: "Freundschaft angenommen",
        body: `${from} hat deine Anfrage angenommen.`,
        url: `${env.appOrigin}/freunde`,
        tag: "friend_accepted",
      };
    case "variation":
      return {
        title: "Neue Variation",
        body: `${from} hat eine Variation von „${recipeTitle}“ erstellt.`,
        url: recipeUrl,
        tag: recipeId ? `variation:${recipeId}` : "variation",
      };
    case "timer":
      return {
        title: "Timer abgelaufen",
        body: "Dein Timer ist abgelaufen.",
        url: recipeId ? `${env.appOrigin}/rezept/${recipeId}/kochen` : `${env.appOrigin}/`,
        tag: recipeId ? `timer:${recipeId}` : "timer",
      };
    default:
      return {
        title: "Kochen",
        body: "Es gibt etwas Neues für dich.",
        url: `${env.appOrigin}/benachrichtigungen`,
        tag: "kochen",
      };
  }
}

export async function runPushJob(job: JobRow): Promise<void> {
  try {
    const raw = job.payload.notification;
    if (!raw || typeof raw !== "object") {
      await finishJob(job.id, "done");
      return;
    }
    const notification = raw as { kind?: unknown; payload?: unknown };
    const kind = asString(notification.kind);
    if (!kind) {
      await finishJob(job.id, "done");
      return;
    }
    const payload =
      notification.payload && typeof notification.payload === "object"
        ? (notification.payload as Record<string, unknown>)
        : {};
    if (!job.userId) {
      await finishJob(job.id, "done");
      return;
    }

    if (!env.vapidConfigured) {
      logger.warn({ jobId: job.id, kind }, "push_skipped_no_vapid");
      await finishJob(job.id, "done");
      return;
    }

    const sql = db();
    const subscriptions = await sql<SubscriptionRow[]>`
      select id, endpoint, keys from push_subscriptions
      where user_id = ${job.userId} and failed_at is null
    `;
    if (subscriptions.length === 0) {
      await finishJob(job.id, "done");
      return;
    }

    const text = pushText(kind, payload);
    const message = JSON.stringify(text);
    webpush.setVapidDetails(env.vapid.subject, env.vapid.publicKey, env.vapid.privateKey);

    let sent = 0;
    let gone = 0;
    for (const subscription of subscriptions) {
      const keys = parseKeys(subscription.keys);
      if (!keys) {
        await sql`update push_subscriptions set failed_at = now() where id = ${subscription.id}`;
        gone += 1;
        continue;
      }
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys },
          message,
          { TTL: 300, urgency: "high" },
        );
        sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await sql`update push_subscriptions set failed_at = now() where id = ${subscription.id}`;
          gone += 1;
          continue;
        }
        logger.warn({ jobId: job.id, status: status ?? null }, "push_send_failed");
      }
    }

    await finishJob(job.id, "done");
    logger.info({ jobId: job.id, kind, sent, gone }, "push_finished");
  } catch (error) {
    logger.error({ jobId: job.id, err: error instanceof Error ? error.message : String(error) }, "push_failed");
    await failJob(job, "internal", "Die Benachrichtigung konnte nicht gesendet werden.", true);
  }
}
