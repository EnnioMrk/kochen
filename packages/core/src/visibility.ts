/** One visibility policy. No route builds its own visibility query. */

export type Visibility = "private" | "friends" | "members";

export type Viewer = {
  userId: string | null;
  isFriend: boolean;
  /** Holds a valid private link for this recipe. */
  hasPrivateLink: boolean;
  isMember: boolean;
};

export type RecipeAccess = {
  ownerId: string;
  visibility: Visibility;
  archivedAt?: string | null;
  deletedAt?: string | null;
};

export type Access = {
  view: boolean;
  comment: boolean;
  edit: boolean;
  share: boolean;
};

/**
 * Table from TECH §5:
 * - owner: read and write, private or not.
 * - friend: reads and comments a non-private recipe.
 * - member via profile: reads a non-private recipe only.
 * - friend of a friend in a list: nothing.
 * - member with a private link: reads and comments a non-private recipe.
 * A private recipe never opens for a non-owner, not even by link.
 */
export function accessFor(viewer: Viewer, recipe: RecipeAccess): Access {
  const isOwner = viewer.userId !== null && viewer.userId === recipe.ownerId;
  const notPrivate = recipe.visibility !== "private";
  const canRead = isOwner || (notPrivate && viewer.isMember && (viewer.isFriend || viewer.hasPrivateLink || recipe.visibility === "members"));
  const canComment = isOwner || (notPrivate && viewer.isMember && (viewer.isFriend || viewer.hasPrivateLink));
  const canEdit =
    isOwner && !recipe.archivedAt && !recipe.deletedAt;
  return {
    view: canRead && (!recipe.deletedAt || isOwner),
    comment: canComment && !recipe.deletedAt && viewer.userId !== null,
    edit: canEdit,
    share: isOwner && !recipe.deletedAt,
  };
}

/** A private link is scoped to one recipe and never grants writes. */
export function linkGrants(recipe: RecipeAccess): boolean {
  return recipe.visibility !== "private" && !recipe.deletedAt;
}

export function canSeeProfile(viewer: { userId: string | null; isMember: boolean }, targetDeleted: boolean): boolean {
  return viewer.userId !== null && viewer.isMember && !targetDeleted;
}
