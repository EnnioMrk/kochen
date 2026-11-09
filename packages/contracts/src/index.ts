import { z } from "zod";

/** Every API answer uses one envelope. */
export const OkEnvelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ ok: z.literal(true), data });
export const ErrorEnvelope = z.object({
  ok: z.literal(false),
  error: z.string(),
  code: z.string(),
});
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

/** Stable error codes. The UI maps each code to German text. */
export const ERROR_CODES = [
  "unauthenticated",
  "not_member",
  "forbidden",
  "not_found",
  "validation_failed",
  "limit_exceeded",
  "ai_unavailable",
  "rate_limited",
  "extraction_failed",
  "conflict",
  "internal",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const Role = z.enum(["member", "admin", "owner"]);
export type Role = z.infer<typeof Role>;

export const Visibility = z.enum(["private", "friends", "members"]);
export type Visibility = z.infer<typeof Visibility>;

export const User = z.object({
  id: z.string().uuid(),
  platformSub: z.string(),
  email: z.string().nullable(),
  name: z.string(),
  role: Role,
  avatarUrl: z.string().nullable().optional(),
  friendListVisible: z.boolean().default(true),
  cookingView: z.enum(["steps", "overview"]).default("steps"),
  createdAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type User = z.infer<typeof User>;

export const PublicUser = User.pick({
  id: true,
  name: true,
  avatarUrl: true,
  deletedAt: true,
});
export type PublicUser = z.infer<typeof PublicUser>;

/** Units are rows in a table, but the keys are a closed contract. */
export const UnitKey = z.enum([
  "g",
  "kg",
  "ml",
  "l",
  "tl",
  "el",
  "stueck",
  "prise",
  "bund",
  "dose",
  "packung",
  "zehe",
  "scheibe",
  "tasse",
  "min",
]);
export type UnitKey = z.infer<typeof UnitKey>;

export const Ingredient = z.object({
  id: z.string().optional(),
  position: z.number().int().nonnegative(),
  amount: z.number().positive().nullable(),
  unit: UnitKey.nullable(),
  unitLabel: z.string().nullable().optional(),
  name: z.string().min(1).max(200),
  note: z.string().max(300).nullable().optional(),
  lineageKey: z.string().optional(),
});
export type Ingredient = z.infer<typeof Ingredient>;

export const RecipeStep = z.object({
  id: z.string().optional(),
  position: z.number().int().nonnegative(),
  text: z.string().min(1).max(4000),
  durationS: z.number().int().positive().nullable().optional(),
  lineageKey: z.string().optional(),
});
export type RecipeStep = z.infer<typeof RecipeStep>;

export const RecipeImage = z.object({
  id: z.string().optional(),
  url: z.string(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  kind: z.enum(["cover", "step", "original"]).default("cover"),
  position: z.number().int().nonnegative().default(0),
});
export type RecipeImage = z.infer<typeof RecipeImage>;

export const SourceType = z.enum(["manual", "photo", "link", "video", "text", "pdf"]);
export type SourceType = z.infer<typeof SourceType>;

export const RecipeInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  servings: z.number().int().min(1).max(100),
  ingredients: z.array(Ingredient.omit({ id: true })).min(0),
  steps: z.array(RecipeStep.omit({ id: true })).min(0),
  sourceType: SourceType.default("manual"),
  sourceUrl: z.string().url().nullable().optional(),
  rawText: z.string().max(200_000).nullable().optional(),
  transcript: z.string().max(200_000).nullable().optional(),
  originalLang: z.string().max(16).nullable().optional(),
  visibility: Visibility.default("friends"),
  tagNames: z.array(z.string().max(60)).max(30).default([]),
  categoryIds: z.array(z.string().uuid()).max(20).default([]),
});
export type RecipeInput = z.infer<typeof RecipeInput>;

export const RecipeSummary = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  servings: z.number().int(),
  owner: PublicUser,
  coverUrl: z.string().nullable(),
  tags: z.array(z.string()),
  categories: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  visibility: Visibility,
  parentId: z.string().uuid().nullable(),
  rootId: z.string().uuid(),
  depth: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
  myRating: z.number().nullable().optional(),
  avgRating: z.number().nullable().optional(),
  ratingCount: z.number().int().optional(),
  cookedByMe: z.boolean().optional(),
  /** True when a friend of the viewer created a variation of this recipe. */
  variedByFriends: z.array(PublicUser).optional(),
});
export type RecipeSummary = z.infer<typeof RecipeSummary>;

export const RecipeDetail = RecipeSummary.extend({
  ingredients: z.array(Ingredient),
  steps: z.array(RecipeStep),
  images: z.array(RecipeImage),
  sourceType: SourceType,
  sourceUrl: z.string().nullable(),
  rawText: z.string().nullable(),
  transcript: z.string().nullable(),
  originalLang: z.string().nullable(),
  forkedAt: z.string().nullable(),
  predecessorChanged: z.boolean().optional(),
  myCookStatus: z
    .object({
      state: z.enum(["untested", "cooked"]),
      count: z.number().int(),
      lastCookedAt: z.string().nullable(),
    })
    .optional(),
  canEdit: z.boolean(),
  canComment: z.boolean(),
});
export type RecipeDetail = z.infer<typeof RecipeDetail>;

export const RecipeListQuery = z.object({
  scope: z.enum(["mine", "friends", "all", "variations"]).default("mine"),
  tags: z.array(z.string()).default([]),
  archived: z.boolean().default(false),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(30),
});
export type RecipeListQuery = z.infer<typeof RecipeListQuery>;

/** Ratings and cook state. */
export const STAR_VALUES = [
  0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5,
] as const;
export const Stars = z.union([
  z.literal(0.5),
  z.literal(1),
  z.literal(1.5),
  z.literal(2),
  z.literal(2.5),
  z.literal(3),
  z.literal(3.5),
  z.literal(4),
  z.literal(4.5),
  z.literal(5),
]);
export type Stars = z.infer<typeof Stars>;

export const CookStatus = z.object({
  recipeId: z.string().uuid(),
  userId: z.string().uuid(),
  state: z.enum(["untested", "cooked"]),
  count: z.number().int(),
  lastCookedAt: z.string().nullable(),
});
export type CookStatus = z.infer<typeof CookStatus>;

export const RateInput = z.object({ stars: Stars });

/** Variations. */
export const ForkInput = z.object({
  title: z.string().min(1).max(200).optional(),
  servings: z.number().int().min(1).max(100).optional(),
  ingredients: z.array(Ingredient.omit({ id: true, lineageKey: true })).optional(),
  steps: z.array(RecipeStep.omit({ id: true, lineageKey: true })).optional(),
});
export type ForkInput = z.infer<typeof ForkInput>;

export const DiffEntry = z.object({
  kind: z.enum(["same", "changed", "added", "removed", "moved"]),
  lineageKey: z.string(),
  positionA: z.number().int().nullable(),
  positionB: z.number().int().nullable(),
  a: z.record(z.string(), z.unknown()).nullable(),
  b: z.record(z.string(), z.unknown()).nullable(),
  fields: z.array(z.string()),
});
export type DiffEntry = z.infer<typeof DiffEntry>;

export const RecipeDiff = z.object({
  predecessorId: z.string().uuid(),
  variationId: z.string().uuid(),
  predecessorChanged: z.boolean(),
  ingredients: z.array(DiffEntry),
  steps: z.array(DiffEntry),
});
export type RecipeDiff = z.infer<typeof RecipeDiff>;

/** Social. */
export const CommentInput = z.object({
  body: z.string().min(1).max(4000),
  parentId: z.string().uuid().nullable().optional(),
});
export const Comment = z.object({
  id: z.string().uuid(),
  recipeId: z.string().uuid(),
  author: PublicUser,
  parentId: z.string().uuid().nullable(),
  body: z.string(),
  createdAt: z.string(),
  deletedAt: z.string().nullable(),
  replies: z.array(z.lazy((): z.ZodTypeAny => Comment)).optional(),
});
export type Comment = z.infer<typeof Comment>;

export const FriendRequestInput = z.object({
  token: z.string().min(10),
});
export const FriendRequest = z.object({
  id: z.string().uuid(),
  from: PublicUser,
  to: PublicUser,
  status: z.enum(["pending", "accepted", "denied"]),
  createdAt: z.string(),
});
export type FriendRequest = z.infer<typeof FriendRequest>;

export const Profile = z.object({
  user: PublicUser,
  isFriend: z.boolean(),
  friendListVisible: z.boolean(),
  friends: z.array(PublicUser).optional(),
  recipes: z.array(RecipeSummary),
  variations: z.array(RecipeSummary),
});
export type Profile = z.infer<typeof Profile>;

export type PrivateLink = z.infer<typeof PrivateLinkSchema>;

const PrivateLinkSchema = z.object({
  id: z.string().uuid(),
  url: z.string(),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
});

/** Tags and categories. */
export const Tag = z.object({ slug: z.string(), label: z.string(), usage: z.number().int() });
export type Tag = z.infer<typeof Tag>;

export const CategoryInput = z.object({ name: z.string().min(1).max(60) });
export const Category = z.object({
  id: z.string().uuid(),
  name: z.string(),
  recipeCount: z.number().int().optional(),
});
export type Category = z.infer<typeof Category>;

export const TagSuggestion = z.object({
  existing: z.array(Tag),
  newTags: z.array(z.string()),
  category: z.string().nullable(),
});

/** AI. */
export const AiQuestion = z.object({
  question: z.string().min(1).max(2000),
  recipeId: z.string().uuid().optional(),
});
export const AiAnswer = z.object({
  answer: z.string(),
  provider: z.string(),
  kind: z.enum(["answer", "substitution", "amount", "success", "missing_ingredient"]),
});

export const FilterDsl = z
  .object({
    tagsAll: z.array(z.string()).max(20).default([]),
    tagsAny: z.array(z.string()).max(20).default([]),
    categories: z.array(z.string()).max(20).default([]),
    ratings: z
      .array(
        z.object({
          person: z.string(),
          min: z.number().min(0.5).max(5),
        }),
      )
      .max(10)
      .default([]),
    cookedBy: z.array(z.string()).max(10).default([]),
    owner: z.enum(["me", "friends", "all"]).default("all"),
    sort: z.enum(["rating_desc", "newest", "title"]).default("rating_desc"),
  })
  .strict();
export type FilterDsl = z.infer<typeof FilterDsl>;

export const SearchInput = z.object({ query: z.string().min(1).max(500) });
export const SearchResult = z.object({
  filter: FilterDsl,
  recipes: z.array(RecipeSummary),
});
export type SearchResult = z.infer<typeof SearchResult>;

/** Capture. */
export const UploadKind = z.enum(["photo", "pdf", "video", "audio", "text", "link"]);
export const PresignInput = z.object({
  files: z
    .array(
      z.object({
        filename: z.string().min(1).max(255),
        contentType: z.string().min(1).max(150),
        size: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(20),
  kind: UploadKind,
});
export const PresignedFile = z.object({
  key: z.string(),
  uploadUrl: z.string(),
  headers: z.record(z.string(), z.string()),
});
export const ImportInput = z.object({
  kind: UploadKind,
  text: z.string().max(200_000).optional(),
  url: z.string().url().optional(),
  keys: z.array(z.string()).max(20).default([]),
});
export type ImportInput = z.infer<typeof ImportInput>;

export const JobState = z.enum([
  "queued",
  "fetching",
  "normalizing",
  "understanding",
  "needs_review",
  "done",
  "failed",
]);
export type JobState = z.infer<typeof JobState>;

export const ImportJob = z.object({
  id: z.string().uuid(),
  kind: UploadKind,
  state: JobState,
  position: z.number().int().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  draft: RecipeInput.nullable(),
  draftMeta: z
    .object({
      warnings: z.array(z.string()).default([]),
      asksForScreenshot: z.boolean().default(false),
      sourceLang: z.string().nullable(),
    })
    .nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ImportJob = z.infer<typeof ImportJob>;

export const Limits = z.object({
  maxVideoMinutes: z.number().positive(),
  maxAudioMinutes: z.number().positive(),
  maxPhotos: z.number().int().positive(),
  maxPhotoMb: z.number().positive(),
  maxTotalMb: z.number().positive(),
  maxPdfPages: z.number().int().positive(),
});
export type Limits = z.infer<typeof Limits>;
export const DEFAULT_LIMITS: Limits = {
  maxVideoMinutes: 20,
  maxAudioMinutes: 20,
  maxPhotos: 10,
  maxPhotoMb: 10,
  maxTotalMb: 25,
  maxPdfPages: 10,
};

/** Shopping list. */
export const ShoppingInput = z.object({
  items: z
    .array(
      z.object({
        recipeId: z.string().uuid(),
        servings: z.number().int().min(1).max(100),
      }),
    )
    .min(1)
    .max(30),
});
export const ShoppingItem = z.object({
  key: z.string(),
  name: z.string(),
  amount: z.number().nullable(),
  unit: UnitKey.nullable(),
  unitLabel: z.string().nullable(),
  sources: z.array(z.string()),
});
export const ShoppingList = z.object({
  items: z.array(ShoppingItem),
  warnings: z.array(z.string()),
});
export type ShoppingList = z.infer<typeof ShoppingList>;

/** Notifications. */
export const NotificationKind = z.enum([
  "comment",
  "reply",
  "friend_request",
  "friend_accepted",
  "variation",
  "timer",
]);
export const Notification = z.object({
  id: z.string().uuid(),
  kind: NotificationKind,
  payload: z.record(z.string(), z.unknown()),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof Notification>;

export const TimerInput = z.object({
  stepId: z.string().min(1),
  seconds: z.number().int().positive().max(24 * 3600),
});
export const Timer = z.object({
  id: z.string().uuid(),
  stepId: z.string(),
  endsAt: z.string(),
  notifiedAt: z.string().nullable(),
});
export type Timer = z.infer<typeof Timer>;

export const PushSubscriptionInput = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});
