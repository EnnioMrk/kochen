import type { FilterDsl } from "@kochen/contracts";

export class FilterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilterValidationError";
  }
}

export type FilterContext = {
  viewerId: string;
  friendIds: string[];
  /** Tokens the model may use for a person, mapped to user ids. `me` is always present. */
  persons: Record<string, string>;
  knownTags: string[];
  knownCategories: string[];
};

export type CompiledFilter = {
  sql: string;
  params: unknown[];
  whereSql: string;
  orderBy: string;
};

/**
 * Compile the AI filter DSL to parameterized SQL. The model never writes SQL.
 * Unknown persons, tags and categories are validation errors, not empty lists.
 */
export function compileFilter(dsl: FilterDsl, ctx: FilterContext, startAt = 1): CompiledFilter {
  const params: unknown[] = [];
  const p = (value: unknown): string => {
    params.push(value);
    return `$${startAt + params.length - 1}`;
  };

  const knownTags = new Set(ctx.knownTags.map((t) => t.toLowerCase()));
  for (const tag of [...dsl.tagsAll, ...dsl.tagsAny]) {
    if (!knownTags.has(tag.toLowerCase())) {
      throw new FilterValidationError(`unknown_tag:${tag}`);
    }
  }
  const knownCategories = new Set(ctx.knownCategories.map((c) => c.toLowerCase()));
  for (const category of dsl.categories) {
    if (!knownCategories.has(category.toLowerCase())) {
      throw new FilterValidationError(`unknown_category:${category}`);
    }
  }

  const resolvePerson = (token: string): string => {
    const key = token === "ich" || token === "me" ? "me" : token;
    const lower = key.toLowerCase();
    const direct = ctx.persons[key] ?? ctx.persons[lower];
    if (direct) {
      if (direct !== ctx.viewerId && !ctx.friendIds.includes(direct)) {
        throw new FilterValidationError(`unknown_person:${token}`);
      }
      return direct;
    }
    throw new FilterValidationError(`unknown_person:${token}`);
  };

  const where: string[] = ["r.deleted_at is null", "r.archived_at is null"];
  const viewer = p(ctx.viewerId);
  where.push(`(r.visibility <> 'private' or r.owner_id = ${viewer})`);

  if (dsl.owner === "me") {
    where.push(`r.owner_id = ${p(ctx.viewerId)}`);
  } else if (dsl.owner === "friends") {
    if (ctx.friendIds.length === 0) {
      where.push("false");
    } else {
      where.push(`r.owner_id = any(${p(ctx.friendIds)}::uuid[])`);
    }
  } else {
    // All visible recipes: own, friends, and public-to-members recipes.
    const friends = ctx.friendIds.length > 0
      ? `r.owner_id = any(${p(ctx.friendIds)}::uuid[])`
      : "false";
    where.push(`(r.owner_id = ${p(ctx.viewerId)} or ${friends} or r.visibility = 'members')`);
  }

  for (const tag of dsl.tagsAll) {
    where.push(
      `exists (select 1 from recipe_tags rt join tags t on t.id = rt.tag_id where rt.recipe_id = r.id and lower(t.slug) = lower(${p(tag)}))`,
    );
  }
  if (dsl.tagsAny.length > 0) {
    where.push(
      `exists (select 1 from recipe_tags rt join tags t on t.id = rt.tag_id where rt.recipe_id = r.id and lower(t.slug) = any(${p(dsl.tagsAny.map((t) => t.toLowerCase()))}::text[]))`,
    );
  }
  if (dsl.categories.length > 0) {
    where.push(
      `exists (select 1 from recipe_categories rc join categories c on c.id = rc.category_id where rc.recipe_id = r.id and lower(c.name) = any(${p(dsl.categories.map((c) => c.toLowerCase()))}::text[]))`,
    );
  }

  for (const rating of dsl.ratings) {
    const personId = resolvePerson(rating.person);
    where.push(`rating_chain(r.id, ${p(personId)}::uuid) >= ${p(rating.min)}`);
  }

  for (const person of dsl.cookedBy) {
    const personId = resolvePerson(person);
    where.push(
      `exists (select 1 from cook_events ce where ce.recipe_id = r.id and ce.user_id = ${p(personId)}::uuid)`,
    );
  }

  const sort =
    dsl.sort === "newest"
      ? "r.created_at desc"
      : dsl.sort === "title"
        ? "r.title asc"
        : "coalesce((select avg(ra.stars) from ratings ra where ra.recipe_id = r.id), 0) desc, r.created_at desc";

  const whereSql = where.join(" and ");
  return {
    sql: `select r.* from recipes r where ${whereSql} order by ${sort}`,
    params,
    whereSql,
    orderBy: sort,
  };
}

/** The model may only name persons the viewer can rate: self and friends. */
export function personTokens(viewer: { id: string; name: string }, friends: Array<{ id: string; name: string }>): Record<string, string> {
  const out: Record<string, string> = { me: viewer.id, ich: viewer.id, self: viewer.id };
  for (const friend of friends) {
    out[friend.id] = friend.id;
    out[friend.name] = friend.id;
    out[friend.name.toLowerCase()] = friend.id;
  }
  return out;
}
