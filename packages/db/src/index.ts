import postgres from "postgres";

export type Db = postgres.Sql<Record<string, unknown>>;

let instance: Db | null = null;

export function db(url = process.env.DATABASE_URL): Db {
  if (instance) return instance;
  if (!url) throw new Error("DATABASE_URL is not set");
  instance = postgres(url, {
    max: Number(process.env.DB_POOL ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => {},
  });
  return instance;
}

export async function closeDb(): Promise<void> {
  if (instance) {
    await instance.end({ timeout: 5 });
    instance = null;
  }
}

/** Run a function in one transaction. */
export async function tx<T>(fn: (sql: postgres.TransactionSql<Record<string, unknown>>) => Promise<T>): Promise<T> {
  const result = await db().begin(async (sql) => fn(sql));
  return result as T;
}

export type { postgres };
