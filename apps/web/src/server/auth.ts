import type { MiddlewareHandler } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { db } from "@kochen/db";
import { env } from "./env";
import { notMember, unauthenticated } from "./errors";

export type LocalUser = {
  id: string;
  platformSub: string;
  email: string | null;
  name: string;
  role: "member" | "admin" | "owner";
  avatarUrl: string | null;
  friendListVisible: boolean;
  cookingView: "steps" | "overview";
  deletedAt: string | null;
};

export type TokenClaims = {
  sub: string;
  email?: string;
  name?: string;
  role?: string;
  projects?: string[];
  iss?: string;
  aud?: string | string[];
};

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function keySet(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(env.jwksUrl), {
      cacheMaxAge: 60 * 60 * 1000,
      cooldownDuration: 30_000,
    });
  }
  return jwks;
}

/** Dev only: `dev:<sub>:<email>:<name>`. Never enabled in production. */
function devClaims(token: string): TokenClaims | null {
  if (!env.devAuth || env.production) return null;
  if (!token.startsWith("dev:")) return null;
  const [, sub, email, name] = token.split(":");
  if (!sub) return null;
  return {
    sub,
    email: email || `${sub}@local`,
    name: name || sub,
    role: "member",
    projects: [env.audience],
  };
}

export async function verifyToken(token: string): Promise<TokenClaims> {
  const dev = devClaims(token);
  if (dev) return dev;
  try {
    const { payload } = await jwtVerify(token, keySet(), {
      audience: env.audience,
      ...(env.issuer ? { issuer: env.issuer } : {}),
      clockTolerance: 10,
    });
    if (!payload.sub) throw new Error("missing sub");
    return {
      sub: String(payload.sub),
      email: typeof payload.email === "string" ? payload.email : undefined,
      name: typeof payload.name === "string" ? payload.name : undefined,
      role: typeof payload.role === "string" ? payload.role : undefined,
      projects: Array.isArray(payload.projects) ? payload.projects.map(String) : [],
      iss: typeof payload.iss === "string" ? payload.iss : undefined,
      aud: payload.aud as string | string[] | undefined,
    };
  } catch (error) {
    console.warn(JSON.stringify({ level: "warn", message: "token_rejected", reason: (error as Error).message }));
    throw unauthenticated();
  }
}

export function hasGrant(claims: TokenClaims): boolean {
  const role = claims.role ?? "member";
  if (role === "owner" || role === "admin") return true;
  return (claims.projects ?? []).includes(env.audience);
}

export async function upsertUser(claims: TokenClaims): Promise<LocalUser> {
  const sql = db();
  const role = claims.role === "owner" || claims.role === "admin" ? claims.role : "member";
  const rows = await sql<LocalUser[]>`
    insert into users (platform_sub, email, name, role)
    values (${claims.sub}, ${claims.email ?? null}, ${claims.name ?? "Mitglied"}, ${role})
    on conflict (platform_sub) do update
      set email = coalesce(excluded.email, users.email),
          name = case when excluded.name <> '' then excluded.name else users.name end,
          role = case when excluded.role in ('owner','admin') then excluded.role else users.role end
    returning id,
              platform_sub as "platformSub",
              email,
              name,
              role,
              avatar_url as "avatarUrl",
              friend_list_visible as "friendListVisible",
              cooking_view as "cookingView",
              deleted_at as "deletedAt"
  `;
  const user = rows[0];
  if (!user) throw new Error("user upsert failed");
  return user;
}

export const requireUser: MiddlewareHandler = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw unauthenticated();
  const claims = await verifyToken(token);
  if (!hasGrant(claims)) throw notMember();
  const user = await upsertUser(claims);
  if (user.deletedAt) throw notMember();
  c.set("user", user);
  c.set("claims", claims);
  await next();
};

/** Dev token for tests and local work. */
export function devToken(sub = "dev-user", email = "dev@local", name = "Dev"): string {
  return `dev:${sub}:${email}:${name}`;
}
