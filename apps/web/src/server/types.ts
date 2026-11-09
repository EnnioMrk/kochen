import type { LocalUser, TokenClaims } from "./auth";

export type AppEnv = {
  Variables: {
    user: LocalUser;
    claims: TokenClaims;
  };
};
