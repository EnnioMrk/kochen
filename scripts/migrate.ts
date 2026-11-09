import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { db, closeDb } from "../packages/db/src/index";

const dir = join(process.cwd(), "packages", "db", "migrations");

async function main(): Promise<void> {
  const sql = db();
  await sql`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `;
  const applied = new Set(
    (await sql`select name from schema_migrations`).map((row) => String(row.name)),
  );
  const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip ${file}`);
      continue;
    }
    const text = await readFile(join(dir, file), "utf8");
    console.log(`apply ${file}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
  }
  await closeDb();
  console.log("migrations done");
}

main().catch(async (error) => {
  console.error(error);
  await closeDb().catch(() => {});
  process.exit(1);
});
