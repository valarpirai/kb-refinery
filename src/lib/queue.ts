import { PgBoss } from "pg-boss";

export const REFINE_QUEUE = "refine-article";
export const PULL_QUEUE = "pull-source";

const globalForBoss = globalThis as unknown as { boss?: Promise<PgBoss> };

/**
 * Connection string without Prisma's `schema` query parameter, which pg rejects.
 * @return a plain Postgres URL
 */
function connectionString(): string {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.searchParams.delete("schema");
  return url.toString();
}

/**
 * Shared, started pg-boss instance with the app's queues created.
 * Reused across hot reloads so connections are not leaked.
 * @return the started PgBoss instance
 */
export function getBoss(): Promise<PgBoss> {
  globalForBoss.boss ??= (async () => {
    const boss = new PgBoss(connectionString());
    boss.on("error", (e) => console.error("[pg-boss]", e));
    await boss.start();
    await boss.createQueue(REFINE_QUEUE);
    await boss.createQueue(PULL_QUEUE);
    return boss;
  })();
  return globalForBoss.boss;
}
