import { Hono } from "hono";
import { z } from "zod";
import type { Profile } from "@kochen/contracts";
import { db } from "@kochen/db";
import { requireUser } from "../auth";
import { env } from "../env";
import { forbidden, invalid, notFound, ok } from "../errors";
import { randomToken, sha256hex } from "../crypto";
import { notify } from "../notify";
import {
  RECIPE_SELECT,
  accessForRecipe,
  friendIdsOf,
  mapFlat,
  requireRecipeRow,
  toSummaries,
  type FlatRecipe,
} from "../repo";
import { publicUser, type UserRow } from "../serializers";
import type { AppEnv } from "../types";
import { body, idParam, linkToken } from "../validate";

export const social = new Hono<AppEnv>();
social.use("*", requireUser);

/* --------------------------------------------------------------------- me */

social.get("/me", async (c) => {
  const user = c.get("user");
  const sql = db();
  const unread = await sql<{ count: number }[]>`
    select count(*)::int as count from notifications where user_id = ${user.id} and read_at is null
  `;
  const invited = await sql<{ count: number }[]>`
    select count(*)::int as count from friendships
    where status = 'pending' and (user_low = ${user.id} or user_high = ${user.id}) and requested_by <> ${user.id}
  `;
  return ok(c, {
    ...user,
    createdAt: new Date().toISOString(),
    unreadNotifications: unread[0]?.count ?? 0,
    friendRequests: invited[0]?.count ?? 0,
  });
});

social.patch("/me", async (c) => {
  const user = c.get("user");
  const input = await body(
    c,
    z.object({
      friendListVisible: z.boolean().optional(),
      cookingView: z.enum(["steps", "overview"]).optional(),
    }),
  );
  const sql = db();
  await sql`
    update users set
      friend_list_visible = coalesce(${input.friendListVisible ?? null}, friend_list_visible),
      cooking_view = coalesce(${input.cookingView ?? null}, cooking_view)
    where id = ${user.id}
  `;
  return ok(c, { updated: true });
});

/* ---------------------------------------------------------------- friends */

social.get("/friends", async (c) => {
  const user = c.get("user");
  const sql = db();
  const rows = await sql<
    { id: string; name: string; avatarUrl: string | null; deletedAt: Date | null }[]
  >`
    select u.id, u.name, u.avatar_url as "avatarUrl", u.deleted_at as "deletedAt"
    from friendships f
    join users u on u.id = case when f.user_low = ${user.id} then f.user_high else f.user_low end
    where f.status = 'accepted' and (f.user_low = ${user.id} or f.user_high = ${user.id})
    order by u.name
  `;
  return ok(c, rows.map((row) => publicUser({ ...row, deletedAt: row.deletedAt })));
});

social.post("/friends/invites", async (c) => {
  const user = c.get("user");
  const token = randomToken(32);
  const hash = await sha256hex(token);
  const sql = db();
  await sql`
    insert into friend_invites (owner_id, token_hash, expires_at)
    values (${user.id}, ${hash}, now() + interval '7 days')
  `;
  return ok(
    c,
    {
      url: new URL(`/f/${token}`, env.appOrigin).toString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    },
    201,
  );
});

social.post("/friends/request", async (c) => {
  const user = c.get("user");
  const input = await body(c, z.object({ token: z.string().min(10).max(200) }));
  const hash = await sha256hex(input.token);
  const sql = db();
  const invites = await sql<{ id: string; ownerId: string }[]>`
    select id, owner_id as "ownerId" from friend_invites
    where token_hash = ${hash} and used_at is null and expires_at > now()
  `;
  const invite = invites[0];
  if (!invite) throw notFound();
  if (invite.ownerId === user.id) throw invalid("self_invite");
  const low = user.id < invite.ownerId ? user.id : invite.ownerId;
  const high = user.id < invite.ownerId ? invite.ownerId : user.id;
  const rows = await sql<{ status: string }[]>`
    insert into friendships (user_low, user_high, status, requested_by)
    values (${low}, ${high}, 'pending', ${user.id})
    on conflict (user_low, user_high) do update
      set status = case when friendships.status = 'accepted' then 'accepted' else 'pending' end
    returning status
  `;
  await sql`update friend_invites set used_at = now() where id = ${invite.id}`;
  if (rows[0]?.status === "pending") {
    await sql.begin(async (tx) => {
      await notify(tx as never, invite.ownerId, "friend_request", { from: user.name, userId: user.id }, `friend-request:${user.id}:${invite.ownerId}`);
    });
  }
  return ok(c, { status: rows[0]?.status ?? "pending" }, 201);
});

social.get("/friends/requests", async (c) => {
  const user = c.get("user");
  const sql = db();
  const rows = await sql<
    {
      id: string;
      createdAt: Date;
      fromId: string;
      fromName: string;
      fromDeleted: Date | null;
      toId: string;
      toName: string;
      status: string;
    }[]
  >`
    select f.user_low || ':' || f.user_high as id,
           f.created_at as "createdAt",
           f.requested_by as "fromId",
           u.name as "fromName", u.deleted_at as "fromDeleted",
           case when f.user_low = ${user.id} then f.user_high else f.user_low end as "toId",
           ${user.name} as "toName",
           f.status
    from friendships f join users u on u.id = f.requested_by
    where f.status = 'pending' and (f.user_low = ${user.id} or f.user_high = ${user.id})
  `;
  return ok(c, rows);
});

social.post("/friends/requests/:id/accept", async (c) => {
  const user = c.get("user");
  const [low, high] = (c.req.param("id") ?? "").split(":");
  if (!low || !high || !/^[0-9a-f-]{36}$/i.test(low) || !/^[0-9a-f-]{36}$/i.test(high)) {
    throw invalid("bad_request_id");
  }
  const sql = db();
  const rows = await sql<{ requestedBy: string }[]>`
    update friendships set status = 'accepted', accepted_at = now()
    where user_low = ${low}::uuid and user_high = ${high}::uuid
      and status = 'pending' and requested_by <> ${user.id}
      and (user_low = ${user.id} or user_high = ${user.id})
    returning requested_by as "requestedBy"
  `;
  const row = rows[0];
  if (!row) throw notFound();
  await sql.begin(async (tx) => {
    await notify(tx as never, row.requestedBy, "friend_accepted", { from: user.name, userId: user.id }, `friend-accepted:${user.id}:${row.requestedBy}`);
  });
  return ok(c, { status: "accepted" });
});

social.post("/friends/requests/:id/deny", async (c) => {
  const user = c.get("user");
  const [low, high] = (c.req.param("id") ?? "").split(":");
  if (!low || !high || !/^[0-9a-f-]{36}$/i.test(low) || !/^[0-9a-f-]{36}$/i.test(high)) {
    throw invalid("bad_request_id");
  }
  const sql = db();
  await sql`
    update friendships set status = 'denied'
    where user_low = ${low}::uuid and user_high = ${high}::uuid
      and status = 'pending' and requested_by <> ${user.id}
      and (user_low = ${user.id} or user_high = ${user.id})
  `;
  return ok(c, { status: "denied" });
});

social.delete("/friends/:id", async (c) => {
  const user = c.get("user");
  const other = idParam(c);
  const sql = db();
  await sql`
    delete from friendships
    where user_low = least(${user.id}::uuid, ${other}::uuid)
      and user_high = greatest(${user.id}::uuid, ${other}::uuid)
  `;
  return ok(c, { removed: true });
});

/* --------------------------------------------------------------- profiles */

social.get("/profiles/:id", async (c) => {
  const user = c.get("user");
  const targetId = idParam(c);
  const sql = db();
  const users = await sql<
    { id: string; name: string; avatarUrl: string | null; deletedAt: Date | null; friendListVisible: boolean }[]
  >`
    select id, name, avatar_url as "avatarUrl", deleted_at as "deletedAt",
           friend_list_visible as "friendListVisible"
    from users where id = ${targetId}
  `;
  const target = users[0];
  if (!target) throw notFound();
  const isFriend = (await friendIdsOf(user.id)).includes(targetId);
  const isSelf = targetId === user.id;

  const recipeRows = await sql.unsafe<FlatRecipe[]>(
    `${RECIPE_SELECT} where r.owner_id = $1 and r.deleted_at is null and r.archived_at is null
       and (r.visibility <> 'private' or $1 = $2) and r.parent_id is null
     order by r.updated_at desc limit 100`,
    [targetId, user.id],
  );
  const variationRows = await sql.unsafe<FlatRecipe[]>(
    `${RECIPE_SELECT} where r.owner_id = $1 and r.deleted_at is null and r.archived_at is null
       and (r.visibility <> 'private' or $1 = $2) and r.parent_id is not null
     order by r.updated_at desc limit 100`,
    [targetId, user.id],
  );

  const friends = isFriend || isSelf
    ? await sql<{ id: string; name: string; avatarUrl: string | null; deletedAt: Date | null }[]>`
        select u.id, u.name, u.avatar_url as "avatarUrl", u.deleted_at as "deletedAt"
        from friendships f
        join users u on u.id = case when f.user_low = ${targetId} then f.user_high else f.user_low end
        where f.status = 'accepted' and (f.user_low = ${targetId} or f.user_high = ${targetId})
        order by u.name limit 200
      `
    : [];

  const profile: Profile = {
    user: publicUser(target as UserRow),
    isFriend,
    friendListVisible: target.friendListVisible,
    friends:
      target.friendListVisible && (isFriend || isSelf)
        ? friends.map((friend) => publicUser(friend as UserRow))
        : undefined,
    recipes: await toSummaries(recipeRows.map(mapFlat), user.id),
    variations: await toSummaries(variationRows.map(mapFlat), user.id),
  };
  return ok(c, profile);
});

/* ------------------------------------------------------------- private link check */

social.post("/links/check", async (c) => {
  const user = c.get("user");
  const input = await body(c, z.object({ recipeId: z.string().uuid(), token: z.string().min(10) }));
  const row = await requireRecipeRow(input.recipeId);
  const access = await accessForRecipe(user.id, row, input.token);
  if (!access.view) throw forbidden();
  return ok(c, { recipeId: row.id, canComment: access.comment, canEdit: access.edit });
});

void linkToken;
