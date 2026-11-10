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

/** Turn yt-dlp stderr into one German sentence with the likely cause. */
function reasonFrom(stderr: string): string {
  const text = stderr.toLowerCase();
  if (text.includes("login") || text.includes("sign in") || text.includes("cookies")) {
    return "Die Plattform verlangt eine Anmeldung. Die Cookies sind abgelaufen oder unvollständig.";
  }
  if (text.includes("private") || text.includes("not available")) {
    return "Das Testvideo ist gesperrt. Bitte prüfe die Cookies.";
  }
  if (text.includes("rate") || text.includes("too many")) {
    return "Die Plattform drosselt den Zugriff. Versuche es später erneut.";
  }
  if (text.includes("unable to download") || text.includes("unable to extract")) {
    return "Die Plattform hat den Abruf abgelehnt.";
  }
  const line = stderr.split("\n").map((row) => row.trim()).filter(Boolean).pop();
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
        message: `${PLATFORM_TITLES[platform]} antwortet mit diesem Zugang.`,
        title,
      } satisfies TestResult,
    });
  } catch (error) {
    const stderr = error instanceof Error ? error.message : String(error);
    await finishJob(job.id, "done", {
      result: {
        ok: false,
        message: reasonFrom(stderr),
      } satisfies TestResult,
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
