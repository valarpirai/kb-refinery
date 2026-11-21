import { db } from "@/lib/db";
import { getBoss, PULL_QUEUE } from "@/lib/queue";

/**
 * Make the queue's schedule for one source match its settings.
 * An enabled source with a cron expression is scheduled. Anything else is not.
 * Throws when the cron expression is invalid.
 * @param source the data source to sync
 */
export async function syncSchedule(source: { id: string; cron: string | null; enabled: boolean }): Promise<void> {
  const boss = await getBoss();
  if (source.enabled && source.cron) {
    await boss.schedule(PULL_QUEUE, source.cron, { dataSourceId: source.id }, { key: source.id });
  } else {
    await boss.unschedule(PULL_QUEUE, source.id);
  }
}

/** Re-apply every source's schedule. The worker calls this on start, so the queue never drifts from the table. */
export async function syncAllSchedules(): Promise<void> {
  for (const source of await db.dataSource.findMany()) {
    try {
      await syncSchedule(source);
    } catch (e) {
      console.warn(`[schedule] ${source.name}: ${(e as Error).message}`);
    }
  }
}

/**
 * Queue a pull right now.
 * @param dataSourceId the source to pull
 */
export async function pullNow(dataSourceId: string): Promise<void> {
  const boss = await getBoss();
  await boss.send(PULL_QUEUE, { dataSourceId });
}
