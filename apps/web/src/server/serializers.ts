import type { Access } from "@kochen/core";
import type {
  Comment,
  CookStatus,
  Ingredient,
  PublicUser,
  RecipeDetail,
  RecipeImage,
  RecipeStep,
  RecipeSummary,
  Stars,
  UnitKey,
  Visibility,
} from "@kochen/contracts";

export type UserRow = {
  id: string;
  name: string;
  avatarUrl: string | null;
  deletedAt: Date | string | null;
};

export type RecipeRow = {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  servings: number;
  bakingTemperature: string | null;
  bakingTime: string | null;
  sourceType: string;
  sourceUrl: string | null;
  rawText: string | null;
  transcript: string | null;
  originalLang: string | null;
  visibility: Visibility;
  parentId: string | null;
  rootId: string | null;
  depth: number;
  forkedAt: Date | string | null;
  archivedAt: Date | string | null;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  owner: UserRow;
};

export function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function isoRequired(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** A deleted account still keeps its name slot but shows the fixed label. */
export function publicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    name: row.deletedAt ? "gelöschtes Konto" : row.name,
    avatarUrl: row.deletedAt ? null : row.avatarUrl,
    deletedAt: iso(row.deletedAt),
  };
}

export type SummaryExtras = {
  coverKey?: string | null;
  tags?: string[];
  categories?: Array<{ id: string; name: string }>;
  avgRating?: number | null;
  ratingCount?: number;
  myRating?: number | null;
  cookedByMe?: boolean;
  variedByFriends?: UserRow[];
  coverUrl?: string | null;
};

export function toSummary(row: RecipeRow, extras: SummaryExtras = {}): RecipeSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    servings: row.servings,
    owner: publicUser(row.owner),
    coverUrl: extras.coverUrl ?? extras.coverKey ?? null,
    tags: extras.tags ?? [],
    categories: extras.categories ?? [],
    visibility: row.visibility,
    parentId: row.parentId,
    rootId: row.rootId ?? row.id,
    depth: row.depth,
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
    archivedAt: iso(row.archivedAt),
    deletedAt: iso(row.deletedAt),
    myRating: extras.myRating ?? null,
    avgRating: extras.avgRating ?? null,
    ratingCount: extras.ratingCount ?? 0,
    cookedByMe: extras.cookedByMe ?? false,
    variedByFriends: (extras.variedByFriends ?? []).map(publicUser),
  };
}

export type IngredientRow = {
  id: string;
  position: number;
  amount: string | number | null;
  unitKey: string | null;
  name: string;
  note: string | null;
  lineageKey: string;
};

export function toIngredient(row: IngredientRow): Ingredient {
  const amount = row.amount === null ? null : Number(row.amount);
  return {
    id: row.id,
    position: row.position,
    amount,
    unit: (row.unitKey as UnitKey | null) ?? null,
    name: row.name,
    note: row.note,
    lineageKey: row.lineageKey,
  };
}

export type StepRow = {
  id: string;
  position: number;
  text: string;
  durationS: number | null;
  lineageKey: string;
};

export function toStep(row: StepRow): RecipeStep {
  return {
    id: row.id,
    position: row.position,
    text: row.text,
    durationS: row.durationS,
    lineageKey: row.lineageKey,
  };
}

export function toImage(row: {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  kind: string;
  position: number;
}): RecipeImage {
  return {
    id: row.id,
    url: row.url,
    width: row.width,
    height: row.height,
    kind: (row.kind as RecipeImage["kind"]) ?? "cover",
    position: row.position,
  };
}

export function toCookStatus(row: {
  state?: string;
  count: number;
  lastCookedAt: Date | string | null;
}): { state: "untested" | "cooked"; count: number; lastCookedAt: string | null } {
  return {
    state: row.count > 0 ? "cooked" : "untested",
    count: row.count,
    lastCookedAt: iso(row.lastCookedAt),
  };
}

export function toDetail(
  row: RecipeRow,
  parts: {
    ingredients: Ingredient[];
    steps: RecipeStep[];
    images: RecipeImage[];
    access: Access;
    extras: SummaryExtras;
    cook?: CookStatus | { state: "untested" | "cooked"; count: number; lastCookedAt: string | null };
    predecessorChanged?: boolean;
  },
): RecipeDetail {
  return {
    ...toSummary(row, parts.extras),
    ingredients: parts.ingredients,
    steps: parts.steps,
    images: parts.images,
    bakingTemperature: row.bakingTemperature,
    bakingTime: row.bakingTime,
    sourceType: row.sourceType as RecipeDetail["sourceType"],
    sourceUrl: row.sourceUrl,
    rawText: row.rawText,
    transcript: row.transcript,
    originalLang: row.originalLang,
    forkedAt: iso(row.forkedAt),
    predecessorChanged: parts.predecessorChanged,
    myCookStatus: parts.cook,
    canEdit: parts.access.edit,
    canComment: parts.access.comment,
    canCook: parts.access.view,
    canRate: parts.access.view,
    canFork: parts.access.view,
    canShare: parts.access.share,
  };
}

export type CommentRow = {
  id: string;
  recipeId: string;
  parentId: string | null;
  body: string;
  createdAt: Date | string;
  deletedAt: Date | string | null;
  author: UserRow;
};

export function toComment(row: CommentRow, replies: Comment[] = []): Comment {
  return {
    id: row.id,
    recipeId: row.recipeId,
    author: publicUser(row.author),
    parentId: row.parentId,
    body: row.deletedAt ? "" : row.body,
    createdAt: isoRequired(row.createdAt),
    deletedAt: iso(row.deletedAt),
    replies,
  };
}

export function parseStars(value: unknown): Stars {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("invalid_stars");
  return number as Stars;
}
