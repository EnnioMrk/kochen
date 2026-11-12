import { execFile } from "node:child_process";
import { env } from "../config";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const MAX_BYTES = 12 * 1024 * 1024;

/**
 * A page after its JavaScript ran, read with the Chromium the image already
 * ships for PDF export. Instagram and TikTok answer a plain HTTP client with a
 * login wall or an empty shell; their public embed pages do render.
 */
export async function renderHtml(url: string, budgetMs = 9000): Promise<string | null> {
  const args = [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    "--mute-audio",
    "--dump-dom",
    `--virtual-time-budget=${budgetMs}`,
    `--user-agent=${UA}`,
    url,
  ];
  return new Promise((resolve) => {
    execFile(
      env.chromiumPath,
      args,
      { timeout: budgetMs + 25_000, maxBuffer: MAX_BYTES, encoding: "utf8" },
      (error, stdout) => {
        if (error || !stdout) {
          resolve(null);
          return;
        }
        resolve(stdout);
      },
    );
  });
}
