import { accessFor, type Access } from "@kochen/core";
import type { RecipeDetail, RecipeSummary, Comment } from "@kochen/contracts";
import { db } from "@kochen/db";
import { sha256hex } from "./crypto";
import { notFound } from "./errors";
import { signedGet } from "./media";
import {
  iso,
  publicUser,
  toComment,
  toCookStatus,
  toDetail,
  toImage,
  toIngredient,
  toStep,
  toSummary,
  type CommentRow,
  type RecipeRow,
  type UserRow,
} from "./serializers";

export const RECIPE_SELECT = `
  select r.id,
         r.owner_id as "ownerId",
         r.title,
         r.description,
         r.servings,
         r.source_type as "sourceType",
         r.source_url as "sourceUrl",
         r.raw_text as "rawText",
         r.transcript,
         r.original_lang as "originalLang",
         r.visibility,
         r.parent_id as "parentId",
         r.root_id as "rootId",
         r.depth,
         r.forked_at as "forkedAt",
         r.archived_at as "archivedAt",
         r.deleted_at as "deletedAt",
         r.created_at as "createdAt",
         r.updated_at as "updatedAt",
         u.id as "owner_id",
         u.name as "owner_name",
         u.avatar_url as "owner_avatar",
         u.deleted_at as "owner_deleted"
  from recipes r
  join users u on u.id = r.owner_id
`;

export type FlatRecipe = Omit<RecipeRow, "owner"> & {
  owner_id: string;
  owner_name: string;
  owner_avatar: string | null;
  owner_deleted: Date | string | null;
};

export function mapFlat(row: FlatRecipe): RecipeRow {
  return {
    id: row.id,
    ownerId: row.ownerId,
    title: row.title,
    description: row.description,
    servings: Number(row.servings),
    sourceType: row.sourceType,
    sourceUrl: row.sourceUrl,
    rawText: row.rawText,
    transcript: row.transcript,
    originalLang: row.originalLang,
    visibility: row.visibility,
    parentId: row.parentId,
    rootId: row.rootId,
    depth: Number(row.depth),
    forkedAt: row.forkedAt,
    archivedAt: row.archivedAt,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    owner: {
      id: row.owner_id,
      name: row.owner_name,
      avatarUrl: row.owner_avatar,
      deletedAt: row.owner_deleted,
    },
  };
}

export async function getRecipeRow(id: string): Promise<RecipeRow | null> {
  const sql = db();
  const rows = await sql.unsafe<FlatRecipe[]>(`${RECIPE_SELECT} where r.id = $1`, [id]);
  return rows[0] ? mapFlat(rows[0]) : null;
}

export async function requireRecipeRow(id: string): Promise<RecipeRow> {
  const row = await getRecipeRow(id);
  if (!row) throw notFound();
  return row;
}

export async function friendIdsOf(userId: string): Promise<string[]> {
  const sql = db();
  const rows = await sql<{ id: string }[]>`
    select case when user_low = ${userId} then user_high else user_low end as id
    from friendships
    where status = 'accepted' and (user_low = ${userId} or user_high = ${userId})
  `;
  return rows.map((row) => row.id);
}

export async function accessForRecipe(
  userId: string,
  row: RecipeRow,
  linkToken?: string | null,
): Promise<Access> {
  const sql = db();
  const friendRows = await sql<{ ok: boolean }[]>`
    select true as ok from friendships
    where status = 'accepted'
      and user_low = least(${userId}::uuid, ${row.ownerId}::uuid)
      and user_high = greatest(${userId}::uuid, ${row.ownerId}::uuid)
  `;
  let hasPrivateLink = false;
  if (linkToken) {
    const hash = await sha256hex(linkToken);
    const links = await sql<{ ok: boolean }[]>`
      select true as ok from private_links
      where token_hash = ${hash} and recipe_id = ${row.id} and revoked_at is null
    `;
    hasPrivateLink = links.length > 0;
  }
  return accessFor(
    {
      userId,
      isFriend: friendRows.length > 0,
      hasPrivateLink,
      isMember: true,
    },
    {
      ownerId: row.ownerId,
      visibility: row.visibility,
      archivedAt: iso(row.archivedAt),
      deletedAt: iso(row.deletedAt),
    },
  );
}

export async function requireVisible(
  userId: string,
  id: string,
  linkToken?: string | null,
): Promise<{ row: RecipeRow; access: Access }> {
  const row = await requireRecipeRow(id);
  const access = await accessForRecipe(userId, row, linkToken);
  if (!access.view) throw notFound();
  return { row, access };
}

type Extras = {
  tags: Map<string, string[]>;
  categories: Map<string, Array<{ id: string; name: string }>>;
  covers: Map<string, string>;
  ratings: Map<string, { avg: number | null; count: number }>;
  mine: Map<string, number>;
  cooked: Set<string>;
  variations: Map<string, UserRow[]>;
};

async function extrasFor(ids: string[], viewerId: string): Promise<Extras> {
  const sql = db();
  const extras: Extras = {
    tags: new Map(),
    categories: new Map(),
    covers: new Map(),
    ratings: new Map(),
    mine: new Map(),
    cooked: new Set(),
    variations: new Map(),
  };
  if (ids.length === 0) return extras;

  const tagRows = await sql<{ recipeId: string; slug: string }[]>`
    select rt.recipe_id as "recipeId", t.slug
    from recipe_tags rt join tags t on t.id = rt.tag_id
    where rt.recipe_id = any(${ids}::uuid[])
    order by t.slug
  `;
  for (const row of tagRows) {
    const list = extras.tags.get(row.recipeId) ?? [];
    list.push(row.slug);
    extras.tags.set(row.recipeId, list);
  }

  const categoryRows = await sql<{ recipeId: string; id: string; name: string }[]>`
    select rc.recipe_id as "recipeId", c.id, c.name
    from recipe_categories rc join categories c on c.id = rc.category_id
    where rc.recipe_id = any(${ids}::uuid[])
    order by c.name
  `;
  for (const row of categoryRows) {
    const list = extras.categories.get(row.recipeId) ?? [];
    list.push({ id: row.id, name: row.name });
    extras.categories.set(row.recipeId, list);
  }

  const coverRows = await sql<{ recipeId: string; key: string }[]>`
    select distinct on (recipe_id) recipe_id as "recipeId", r2_key as key
    from images
    where recipe_id = any(${ids}::uuid[]) and kind in ('cover', 'original')
    order by recipe_id, position
  `;
  await Promise.all(
    coverRows.map(async (row) => {
      extras.covers.set(row.recipeId, await signedGet(row.key));
    }),
  );

  const ratingRows = await sql<{ recipeId: string; avg: number | null; count: number }[]>`
    select recipe_id as "recipeId", avg(stars)::float8 as avg, count(*)::int as count
    from ratings where recipe_id = any(${ids}::uuid[])
    group by recipe_id
  `;
  for (const row of ratingRows) extras.ratings.set(row.recipeId, { avg: row.avg, count: row.count });

  const mineRows = await sql<{ recipeId: string; stars: string }[]>`
    select recipe_id as "recipeId", stars from ratings
    where user_id = ${viewerId} and recipe_id = any(${ids}::uuid[])
  `;
  for (const row of mineRows) extras.mine.set(row.recipeId, Number(row.stars));

  const cookedRows = await sql<{ recipeId: string }[]>`
    select distinct recipe_id as "recipeId" from cook_events
    where user_id = ${viewerId} and recipe_id = any(${ids}::uuid[])
  `;
  for (const row of cookedRows) extras.cooked.add(row.recipeId);

  const variationRows = await sql<
    { parentId: string; id: string; name: string; avatarUrl: string | null; deletedAt: Date | null }[]
  >`
    select c.parent_id as "parentId", u.id, u.name, u.avatar_url as "avatarUrl", u.deleted_at as "deletedAt"
    from recipes c
    join users u on u.id = c.owner_id
    join friendships f
      on f.status = 'accepted'
     and f.user_low = least(${viewerId}::uuid, c.owner_id)
     and f.user_high = greatest(${viewerId}::uuid, c.owner_id)
    where c.parent_id = any(${ids}::uuid[]) and c.deleted_at is null and c.owner_id <> ${viewerId}
  `;
  for (const row of variationRows) {
    const list = extras.variations.get(row.parentId) ?? [];
    list.push({ id: row.id, name: row.name, avatarUrl: row.avatarUrl, deletedAt: row.deletedAt });
    extras.variations.set(row.parentId, list);
  }
  return extras;
}

export async function toSummaries(rows: RecipeRow[], viewerId: string): Promise<RecipeSummary[]> {
  const extras = await extrasFor(rows.map((row) => row.id), viewerId);
  return rows.map((row) =>
    toSummary(row, {
      tags: extras.tags.get(row.id) ?? [],
      categories: extras.categories.get(row.id) ?? [],
      coverUrl: extras.covers.get(row.id) ?? null,
      avgRating: extras.ratings.get(row.id)?.avg ?? null,
      ratingCount: extras.ratings.get(row.id)?.count ?? 0,
      myRating: extras.mine.get(row.id) ?? null,
      cookedByMe: extras.cooked.has(row.id),
      variedByFriends: extras.variations.get(row.id) ?? [],
    }),
  );
}

export async function detailFor(
  row: RecipeRow,
  access: Access,
  viewerId: string,
): Promise<RecipeDetail> {
  const sql = db();
  const [ingredients, steps, imageRows, extra, cookRows, predecessor] = await Promise.all([
    sql<
      { id: string; position: number; amount: string | null; unitKey: string | null; name: string; note: string | null; lineageKey: string }[]
    >`
      select id, position, amount, unit_key as "unitKey", name, note, lineage_key as "lineageKey"
      from recipe_ingredients where recipe_id = ${row.id} order by position
    `,
    sql<{ id: string; position: number; text: string; durationS: number | null; lineageKey: string }[]>`
      select id, position, text, duration_s as "durationS", lineage_key as "lineageKey"
      from recipe_steps where recipe_id = ${row.id} order by position
    `,
    sql<{ id: string; key: string; width: number | null; height: number | null; kind: string; position: number }[]>`
      select id, r2_key as key, width, height, kind, position
      from images where recipe_id = ${row.id} order by position
    `,
    extrasFor([row.id], viewerId),
    sql<{ count: number; lastCookedAt: Date | null }[]>`
      select count(*)::int as count, max(cooked_at) as "lastCookedAt"
      from cook_events where user_id = ${viewerId} and recipe_id = ${row.id}
    `,
    row.parentId
      ? sql<{ updatedAt: Date }[]>`select updated_at as "updatedAt" from recipes where id = ${row.parentId}`
      : Promise.resolve([]),
  ]);

  const images = await Promise.all(
    imageRows.map(async (image) =>
      toImage({ ...image, url: await signedGet(image.key) }),
    ),
  );

  return toDetail(row, {
    ingredients: ingredients.map(toIngredient),
    steps: steps.map(toStep),
    images,
    access,
    extras: {
      tags: extra.tags.get(row.id) ?? [],
      categories: extra.categories.get(row.id) ?? [],
      coverUrl: extra.covers.get(row.id) ?? null,
      avgRating: extra.ratings.get(row.id)?.avg ?? null,
      ratingCount: extra.ratings.get(row.id)?.count ?? 0,
      myRating: extra.mine.get(row.id) ?? null,
      cookedByMe: extra.cooked.has(row.id),
      variedByFriends: extra.variations.get(row.id) ?? [],
    },
    cook: toCookStatus(cookRows[0] ?? { count: 0, lastCookedAt: null }),
    predecessorChanged: Boolean(
      row.forkedAt && predecessor[0]?.updatedAt && new Date(predecessor[0].updatedAt) > new Date(row.forkedAt),
    ),
  });
}

export async function commentsFor(recipeId: string): Promise<Comment[]> {
  const sql = db();
  const rows = await sql<
    {
      id: string;
      recipeId: string;
      parentId: string | null;
      body: string;
      createdAt: Date;
      deletedAt: Date | null;
      authorId: string;
      authorName: string;
      authorAvatar: string | null;
      authorDeleted: Date | null;
    }[]
  >`
    select c.id, c.recipe_id as "recipeId", c.parent_id as "parentId", c.body,
           c.created_at as "createdAt", c.deleted_at as "deletedAt",
           u.id as "authorId", u.name as "authorName",
           u.avatar_url as "authorAvatar", u.deleted_at as "authorDeleted"
    from comments c join users u on u.id = c.author_id
    where c.recipe_id = ${recipeId}
    order by c.created_at asc
  `;
  const mapped: CommentRow[] = rows.map((row) => ({
    id: row.id,
    recipeId: row.recipeId,
    parentId: row.parentId,
    body: row.body,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
    author: {
      id: row.authorId,
      name: row.authorName,
      avatarUrl: row.authorAvatar,
      deletedAt: row.authorDeleted,
    },
  }));
  const roots = mapped.filter((row) => !row.parentId);
  const replies = mapped.filter((row) => row.parentId);
  return roots.map((root) =>
    toComment(
      root,
      replies.filter((reply) => reply.parentId === root.id).map((reply) => toComment(reply)),
    ),
  );
}

export function commentAuthorName(author: UserRow): string {
  return publicUser(author).name;
}
