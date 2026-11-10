import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../config";
import { finishJob, type JobRow } from "../queue";
import { run } from "../tools";
import {
  PLATFORM_TEST_URLS,
  loginArgsFor,
  platformLogin,
  type PlatformName,
} from "../imports/platform-login";
import { YTDLP_JS_ARGS } from "../imports/ytdlp";

type TestResult = {
  ok: boolean;
  message: string;
  title?: string | null;
};

const PLATFORM_TITLES: Record<PlatformName, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
};

function platformOfPayload(payload: Record<string, unknown>): PlatformName | null {
  const value = payload.platform;
  return value === "youtube" || value === "instagram" || value === "tiktok" ? value : null;
}

/** yt-dlp wraps its own message in tool and extractor prefixes. */
function cleanStderr(raw: string): string {
  return raw
    .replace(/^tool_failed:[^:]*:\s*/i, "")
    .replace(/^ERROR:\s*/i, "")
    .replace(/^\[[^\]]+\]\s*[^:]{0,80}:\s*/, "")
    .trim();
}

const COOKIE_ADVICE =
  "Es sind keine Cookies gespeichert. YouTube, Instagram und TikTok lassen den Server fast nur mit Cookies herein.";
const EXPIRED_COOKIES =
  "Die Cookies sind abgelaufen oder unvollständig. Exportiere sie neu und teste erneut.";

/** Turn yt-dlp stderr into one German sentence with the likely cause. */
export function reasonFrom(raw: string, hasCookies: boolean): string {
  const text = cleanStderr(raw);
  const lower = text.toLowerCase();
  const advice = hasCookies ? EXPIRED_COOKIES : COOKIE_ADVICE;

  if (
    lower.includes("sign in") ||
    lower.includes("login") ||
    lower.includes("cookies") ||
    lower.includes("not a bot")
  ) {
    return `Die Plattform verlangt eine Anmeldung. ${advice}`;
  }
  if (lower.includes("video is unavailable") || lower.includes("video unavailable")) {
    return "Das Testvideo ist nicht mehr erreichbar. Der Zugang kann trotzdem stimmen. Bitte melde das dem Betreiber.";
  }
  if (lower.includes("no video formats")) {
    return "yt-dlp konnte kein abspielbares Format lesen. Das liegt am Server, nicht am Zugang. Bitte melde das dem Betreiber.";
  }
  if (lower.includes("rate") || lower.includes("too many") || lower.includes("http error 429")) {
    return "Die Plattform drosselt den Zugriff. Versuche es später erneut.";
  }
  if (
    lower.includes("unexpected response") ||
    lower.includes("unable to download") ||
    lower.includes("unable to extract") ||
    lower.includes("requested content is not available") ||
    lower.includes("http error 401") ||
    lower.includes("http error 403")
  ) {
    return `Die Plattform hat den Abruf abgelehnt. ${advice}`;
  }
  const line = text
    .split("\n")
    .map((row) => row.trim().replace(/^ERROR:\s*/i, ""))
    .filter(Boolean)
    .pop();
  return line ? line.slice(0, 200) : "Der Test ist ohne Antwort abgebrochen.";
}

/**
 * Prove that a stored login works: yt-dlp reads the metadata of one stable
 * public item with the same cookies and password the import would use.
 */
export async function runPlatformTestJob(job: JobRow): Promise<void> {
  const platform = platformOfPayload(job.payload);
  if (!platform) {
    await finishJob(job.id, "done", {
      result: { ok: false, message: "Diese Plattform ist unbekannt." } satisfies TestResult,
    });
    return;
  }

  const login = await platformLogin(platform);
  if (!login) {
    await finishJob(job.id, "done", {
      result: {
        ok: false,
        message: "Kein Zugang hinterlegt. Trage zuerst Benutzername oder Cookies ein.",
      } satisfies TestResult,
    });
    return;
  }

  const dir = await mkdtemp(join(env.tmpRoot, "kochen-test-"));
  try {
    if (login.unreadable) {
      await finishJob(job.id, "done", {
        result: {
          ok: false,
          message:
            "Der gespeicherte Zugang ist nicht lesbar. Der Schlüssel des Servers passt nicht. Bitte trage ihn neu ein.",
        } satisfies TestResult,
      });
      return;
    }

    if (platform !== "youtube" && !login.cookies) {
      await finishJob(job.id, "done", {
        result: {
          ok: false,
          message: `${PLATFORM_TITLES[platform]} lässt den Server nur mit Cookies herein. Ein Passwort allein genügt nicht. Trage die Cookies ein und teste erneut.`,
        } satisfies TestResult,
      });
      return;
    }

    const auth = await loginArgsFor(platform, dir);
    if (auth.length === 0) {
      await finishJob(job.id, "done", {
        result: {
          ok: false,
          message: "Der gespeicherte Zugang ist nicht lesbar. Bitte neu eintragen.",
        } satisfies TestResult,
      });
      return;
    }

    const target = PLATFORM_TEST_URLS[platform];
    const { stdout } = await run("yt-dlp", [
      "--dump-single-json",
      "--no-playlist",
      "--playlist-end",
      "1",
      "--no-warnings",
      // The test only needs the metadata, never the media itself.
      "--ignore-no-formats-error",
      ...YTDLP_JS_ARGS,
      ...auth,
      target,
    ], { timeoutMs: 90_000, maxBuffer: 16 * 1024 * 1024 });

    let title: string | null = null;
    try {
      const meta = JSON.parse(stdout.trim().split("\n")[0] ?? "{}") as { title?: unknown };
      title = typeof meta.title === "string" ? meta.title.slice(0, 120) : null;
    } catch {
      title = null;
    }

    await finishJob(job.id, "done", {
      result: {
        ok: true,
        message: login.cookies
          ? `${PLATFORM_TITLES[platform]} antwortet mit diesem Zugang.`
          : `${PLATFORM_TITLES[platform]} antwortet ohne Anmeldung. Öffentliche Videos lassen sich importieren; für gesperrte Videos fehlen die Cookies.`,
        title,
      } satisfies TestResult,
    });
  } catch (error) {
    const stderr = error instanceof Error ? error.message : String(error);
    await finishJob(job.id, "done", {
      result: {
        ok: false,
        message: reasonFrom(stderr, Boolean(login.cookies)),
      } satisfies TestResult,
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
