import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { db } from "@kochen/db";
import { env } from "./env";
import { errorResponse, notFound } from "./errors";
import { recipes } from "./routes/recipes";
import { imports, jobs } from "./routes/imports";
import { ai } from "./routes/ai";
import { search } from "./routes/search";
import { tags } from "./routes/tags";
import { social } from "./routes/social";
import { shopping } from "./routes/shopping";
import { notifications } from "./routes/notifications";
import { settings } from "./routes/settings";
import { mediaRoutes } from "./routes/media";
import { serveStatic } from "hono/bun";

export const app = new Hono();

app.use("*", logger((message) => {
  console.log(JSON.stringify({ level: "info", message }));
}));

app.use("*", secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "https://api.ennio.vip"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "blob:", "https:"],
    connectSrc: ["'self'", "https://api.ennio.vip", "https://rezepte.ennio.vip", "https://kochen.ennio.vip", env.r2.endpoint || "https://*.r2.cloudflarestorage.com"],
    fontSrc: ["'self'", "data:"],
    frameSrc: ["https://api.ennio.vip"],
    workerSrc: ["'self'", "blob:"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'", "https://api.ennio.vip"],
  },
  xFrameOptions: "DENY",
  referrerPolicy: "no-referrer",
  permissionsPolicy: { camera: ["self"], microphone: [], geolocation: [] },
}));

app.use("*", async (c, next) => {
  await next();
  c.header("x-robots-tag", "noindex, nofollow, noarchive");
  c.header("cache-control", c.req.path.startsWith("/api/") ? "private, no-store" : "no-cache");
});

app.use("/api/*", cors({
  origin: (origin) => (env.allowedOrigins.includes(origin) ? origin : ""),
  credentials: true,
  allowHeaders: ["authorization", "content-type", "x-link-token"],
  allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  maxAge: 600,
}));

/** Canonical host: kochen.ennio.vip answers a 301 for every route except health. */
app.use("*", async (c, next) => {
  const host = (c.req.header("host") ?? "").split(":")[0] ?? "";
  const canonical = env.canonicalHost;
  if (canonical && host && host !== canonical && host !== "localhost" && !host.startsWith("127.") && !host.endsWith(".internal") && !host.startsWith("0.0.0.0")) {
    if (c.req.path === "/healthz") return next();
    const url = new URL(c.req.url);
    url.host = canonical;
    url.protocol = "https:";
    return c.redirect(url.toString(), 301);
  }
  return next();
});

app.get("/healthz", async (c) => {
  try {
    await db()`select 1`;
    return c.json({ ok: true, data: { status: "ok", time: new Date().toISOString() } });
  } catch {
    return c.json({ ok: false, error: "database unavailable", code: "internal" }, 503);
  }
});

app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"));

app.route("/api/recipes", recipes);
app.route("/api/imports", imports);
app.route("/api/jobs", jobs);
app.route("/api/ai", ai);
app.route("/api/search", search);
app.route("/api", mediaRoutes);
app.route("/api", tags);
app.route("/api", social);
app.route("/api/shopping", shopping);
app.route("/api", notifications);
app.route("/api/settings", settings);

app.all("/api/*", () => {
  throw notFound();
});

// One process serves the API and the built SPA.
if (env.production) {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", serveStatic({ path: "./dist/index.html" }));
}

app.onError(errorResponse);

export default app;
