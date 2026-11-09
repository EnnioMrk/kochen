import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@kochen/db";
import { logger, env } from "../config";
import { JobFailure } from "../errors";
import { escapeHtml } from "../media-inspect";
import { exportKey, MediaError, putObject, signedGet } from "../media";
import { failJob, finishJob, setState, type JobRow } from "../queue";
import { MissingToolError, run, ToolError } from "../tools";

type RecipeRow = {
  id: string;
  title: string;
  description: string | null;
  servings: number;
  sourceUrl: string | null;
  ownerName: string;
};

type IngredientRow = {
  position: number;
  amount: string | null;
  unitKey: string | null;
  unitLabel: string | null;
  name: string;
  note: string | null;
};

type StepRow = { position: number; text: string; durationS: number | null };

const PDF_LOOKING = "%PDF-";

export async function runExportPdfJob(job: JobRow): Promise<void> {
  try {
    await processExport(job);
  } catch (error) {
    const failure =
      error instanceof JobFailure
        ? error
        : error instanceof MediaError
          ? new JobFailure(
              "export_failed",
              "Der PDF-Export konnte nicht gespeichert werden: Der Medienspeicher ist nicht konfiguriert.",
            )
          : new JobFailure("export_failed", "Der PDF-Export ist fehlgeschlagen. Bitte versuche es erneut.", true);
    if (!(error instanceof JobFailure)) {
      logger.error({ jobId: job.id, err: error instanceof Error ? error.message : String(error) }, "export_failed");
    }
    await failJob(job, failure.code, failure.message, failure.retryable);
  }
}

async function processExport(job: JobRow): Promise<void> {
  const recipeId = typeof job.payload.recipeId === "string" ? job.payload.recipeId : null;
  if (!recipeId) throw new JobFailure("export_failed", "Es wurde kein Rezept für den Export angegeben.");

  await setState(job.id, "understanding", 20);

  const sql = db();
  const recipeRows = await sql<RecipeRow[]>`
    select r.id, r.title, r.description, r.servings, r.source_url as "sourceUrl",
           coalesce(u.name, 'Unbekannt') as "ownerName"
    from recipes r join users u on u.id = r.owner_id
    where r.id = ${recipeId} and r.deleted_at is null
  `;
  const recipe = recipeRows[0];
  if (!recipe) throw new JobFailure("export_failed", "Das Rezept wurde nicht gefunden.");

  const [ingredients, steps, imageRows] = await Promise.all([
    sql<IngredientRow[]>`
      select i.position, i.amount::text as amount, i.unit_key as "unitKey",
             coalesce(un.label, i.unit_key) as "unitLabel", i.name, i.note
      from recipe_ingredients i
      left join units un on un.key = i.unit_key
      where i.recipe_id = ${recipeId}
      order by i.position
    `,
    sql<StepRow[]>`
      select position, text, duration_s as "durationS"
      from recipe_steps where recipe_id = ${recipeId} order by position
    `,
    sql<{ r2Key: string }[]>`
      select r2_key as "r2Key" from images where recipe_id = ${recipeId}
      order by case when kind = 'cover' then 0 else 1 end, position
      limit 1
    `,
  ]);

  let coverUrl: string | null = null;
  const firstImage = imageRows[0];
  if (firstImage) {
    try {
      coverUrl = await signedGet(firstImage.r2Key);
    } catch {
      logger.warn({ jobId: job.id }, "export_cover_skipped");
    }
  }

  const html = renderRecipeHtml(recipe, ingredients, steps, coverUrl);
  const dir = await mkdtemp(join(env.tmpRoot, "kochen-export-"));
  try {
    const htmlPath = join(dir, "recipe.html");
    const pdfPath = join(dir, "recipe.pdf");
    await writeFile(htmlPath, html, "utf8");

    await setState(job.id, "normalizing", 50);

    const chromium = env.chromiumPath;
    try {
      await run(
        chromium,
        [
          "--headless",
          "--no-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--no-pdf-header-footer",
          `--print-to-pdf=${pdfPath}`,
          `file://${htmlPath}`,
        ],
        { timeoutMs: 120_000, maxBuffer: 8 * 1024 * 1024 },
      );
    } catch (error) {
      if (error instanceof MissingToolError) {
        throw new JobFailure(
          "export_failed",
          "PDF-Export ist nicht verfügbar: Chromium fehlt auf dem Server.",
        );
      }
      if (error instanceof ToolError) {
        logger.error({ jobId: job.id, detail: error.message.slice(0, 500) }, "chromium_failed");
      }
      throw new JobFailure("export_failed", "Der PDF-Export ist fehlgeschlagen. Bitte versuche es erneut.", true);
    }

    let pdf: Buffer;
    try {
      pdf = await readFile(pdfPath);
    } catch {
      throw new JobFailure("export_failed", "Der PDF-Export hat keine Datei erzeugt.", true);
    }
    if (pdf.byteLength < 500 || pdf.subarray(0, 5).toString("latin1") !== PDF_LOOKING) {
      throw new JobFailure("export_failed", "Der PDF-Export hat keine gültige Datei erzeugt.", true);
    }

    await setState(job.id, "understanding", 80);
    const key = exportKey(recipeId);
    await putObject(key, pdf, "application/pdf");

    await finishJob(job.id, "done", { resultKey: key, exportedAt: new Date().toISOString() });
    logger.info({ jobId: job.id, recipeId, bytes: pdf.byteLength }, "export_finished");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function formatAmount(value: string | null): string {
  if (value === null) return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(numeric);
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "";
  const minutes = Math.round(seconds / 60);
  return minutes > 0 ? ` (ca. ${minutes} Min.)` : "";
}

function renderRecipeHtml(
  recipe: RecipeRow,
  ingredients: IngredientRow[],
  steps: StepRow[],
  coverUrl: string | null,
): string {
  const ingredientLines = ingredients
    .map((item) => {
      const amount = formatAmount(item.amount);
      const unit = item.unitLabel ?? "";
      const head = [amount, unit].filter(Boolean).join(" ");
      const note = item.note ? ` <span class="note">(${escapeHtml(item.note)})</span>` : "";
      return `<li><span class="amount">${escapeHtml(head)}</span> ${escapeHtml(item.name)}${note}</li>`;
    })
    .join("\n");

  const stepLines = steps
    .map(
      (step) =>
        `<li>${escapeHtml(step.text)}${escapeHtml(formatDuration(step.durationS))}</li>`,
    )
    .join("\n");

  const cover = coverUrl
    ? `<img class="cover" src="${escapeHtml(coverUrl)}" alt="">`
    : "";

  const source = recipe.sourceUrl
    ? `<p class="source">Quelle: ${escapeHtml(recipe.sourceUrl)}</p>`
    : "";

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${escapeHtml(recipe.title)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: Georgia, "Times New Roman", serif;
    color: #111;
    font-size: 11pt;
    line-height: 1.5;
  }
  h1 { font-size: 24pt; line-height: 1.15; margin: 0 0 2mm; }
  h2 { font-size: 14pt; margin: 8mm 0 3mm; padding-bottom: 1.5mm; border-bottom: 1px solid #999; }
  p { margin: 0 0 3mm; }
  .meta { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 9.5pt; color: #444; margin-bottom: 5mm; }
  .cover { display: block; width: 100%; max-height: 85mm; object-fit: cover; margin: 0 0 6mm; }
  ul, ol { margin: 0; padding-left: 6mm; }
  li { margin: 0 0 2mm; break-inside: avoid; page-break-inside: avoid; }
  .amount { font-weight: bold; }
  .note { color: #555; }
  ol.steps li { margin-bottom: 3mm; }
  .source { margin-top: 8mm; font-family: "Helvetica Neue", Arial, sans-serif; font-size: 8.5pt; color: #555; word-break: break-all; }
</style>
</head>
<body>
${cover}
<h1>${escapeHtml(recipe.title)}</h1>
<p class="meta">Für ${recipe.servings} ${recipe.servings === 1 ? "Portion" : "Portionen"} · von ${escapeHtml(recipe.ownerName)}</p>
${recipe.description ? `<p>${escapeHtml(recipe.description)}</p>` : ""}
<h2>Zutaten</h2>
<ul>
${ingredientLines}
</ul>
<h2>Zubereitung</h2>
<ol class="steps">
${stepLines}
</ol>
${source}
</body>
</html>`;
}
