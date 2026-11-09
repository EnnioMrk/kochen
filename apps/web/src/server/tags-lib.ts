import type { postgres } from "@kochen/db";

type Tx = postgres.TransactionSql<Record<string, unknown>>;

const UMLAUTS: Record<string, string> = {
  ä: "ae", ö: "oe", ü: "ue", ß: "ss", é: "e", è: "e", ê: "e", á: "a", à: "a", í: "i", ó: "o", ú: "u", ñ: "n",
};

export function slugifyTag(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[äöüßéèêáàíóúñ]/g, (char) => UMLAUTS[char] ?? char)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Tag reuse: a new tag appears only when no old tag fits.
 * Similarity above 0.45 or the same slug reuses the existing row.
 */
export async function resolveTag(tx: Tx, name: string): Promise<{ id: string; slug: string; label: string }> {
  const slug = slugifyTag(name);
  if (!slug) throw new Error("empty_tag");
  const existing = await tx<{ id: string; slug: string; label: string }[]>`
    select id, slug, label from tags
    where slug = ${slug} or similarity(label, ${name.trim()}) > 0.45
    order by (slug = ${slug}) desc, similarity(label, ${name.trim()}) desc
    limit 1
  `;
  if (existing[0]) return existing[0];
  const created = await tx<{ id: string; slug: string; label: string }[]>`
    insert into tags (slug, label) values (${slug}, ${name.trim()})
    on conflict (slug) do update set label = tags.label
    returning id, slug, label
  `;
  const tag = created[0];
  if (!tag) throw new Error("tag_insert_failed");
  return tag;
}

export async function attachTags(tx: Tx, recipeId: string, names: string[], userId: string): Promise<void> {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))].slice(0, 30);
  for (const name of unique) {
    const tag = await resolveTag(tx, name);
    await tx`
      insert into recipe_tags (recipe_id, tag_id, confirmed_by)
      values (${recipeId}, ${tag.id}, ${userId})
      on conflict do nothing
    `;
  }
}

export async function attachCategories(tx: Tx, recipeId: string, ids: string[], userId: string): Promise<void> {
  if (ids.length === 0) return;
  const rows = await tx<{ id: string }[]>`
    select id from categories where id = any(${ids}::uuid[]) and owner_id = ${userId}
  `;
  for (const row of rows) {
    await tx`
      insert into recipe_categories (recipe_id, category_id)
      values (${recipeId}, ${row.id}) on conflict do nothing
    `;
  }
}
