/**
 * YouTube serves no formats without a JavaScript runtime. The worker image
 * ships node, so every yt-dlp call enables it. Change it with YTDLP_JS_RUNTIME
 * when an image has deno instead.
 */
export const YTDLP_JS_ARGS = ["--js-runtimes", process.env.YTDLP_JS_RUNTIME ?? "node"];
