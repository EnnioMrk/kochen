import { DEFAULT_LIMITS, Limits } from "@kochen/contracts";
import { db } from "@kochen/db";
import { logger } from "../config";

/** Operator-editable limits, read before a job starts. */
export async function loadLimits(): Promise<Limits> {
  try {
    const sql = db();
    const rows = await sql<{ value: unknown }[]>`select value from app_settings where key = 'limits'`;
    const parsed = Limits.safeParse(rows[0]?.value ?? DEFAULT_LIMITS);
    return parsed.success ? parsed.data : DEFAULT_LIMITS;
  } catch (error) {
    logger.warn({ err: (error as Error).message }, "limits_read_failed");
    return DEFAULT_LIMITS;
  }
}
