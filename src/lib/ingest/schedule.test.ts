import { beforeEach, describe, expect, it, vi } from "vitest";

const boss = { schedule: vi.fn(), unschedule: vi.fn(), send: vi.fn() };
const findMany = vi.fn();

vi.mock("@/lib/db", () => ({ db: { dataSource: { findMany: (...a: unknown[]) => findMany(...a) } } }));
vi.mock("@/lib/queue", () => ({ getBoss: async () => boss, PULL_QUEUE: "pull" }));

import { pullNow, syncAllSchedules, syncSchedule } from "./schedule";

beforeEach(() => {
  boss.schedule.mockResolvedValue(undefined);
  boss.unschedule.mockResolvedValue(undefined);
  boss.send.mockResolvedValue(undefined);
});

describe("syncSchedule", () => {
  it("schedules an enabled source with a cron", async () => {
    await syncSchedule({ id: "a", cron: "0 * * * *", enabled: true });
    expect(boss.schedule).toHaveBeenCalledWith("pull", "0 * * * *", { dataSourceId: "a" }, { key: "a" });
    expect(boss.unschedule).not.toHaveBeenCalled();
  });

  it.each([
    { id: "b", cron: "0 * * * *", enabled: false },
    { id: "c", cron: null, enabled: true },
    { id: "d", cron: "", enabled: true },
  ])("unschedules %j", async (s) => {
    await syncSchedule(s);
    expect(boss.unschedule).toHaveBeenCalledWith("pull", s.id);
    expect(boss.schedule).not.toHaveBeenCalled();
  });

  it("propagates an invalid cron error", async () => {
    boss.schedule.mockRejectedValue(new Error("bad cron"));
    await expect(syncSchedule({ id: "a", cron: "x", enabled: true })).rejects.toThrow("bad cron");
  });
});

describe("syncAllSchedules", () => {
  it("applies every source and survives one failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    findMany.mockResolvedValue([
      { id: "a", name: "A", cron: "bad", enabled: true },
      { id: "b", name: "B", cron: null, enabled: false },
    ]);
    boss.schedule.mockRejectedValue(new Error("bad cron"));
    await syncAllSchedules();
    expect(boss.unschedule).toHaveBeenCalledWith("pull", "b");
    expect(warn).toHaveBeenCalledWith("[schedule] A: bad cron");
  });

  it("does nothing with no sources", async () => {
    findMany.mockResolvedValue([]);
    await syncAllSchedules();
    expect(boss.schedule).not.toHaveBeenCalled();
    expect(boss.unschedule).not.toHaveBeenCalled();
  });
});

describe("pullNow", () => {
  it("queues a pull for the source", async () => {
    await pullNow("z");
    expect(boss.send).toHaveBeenCalledWith("pull", { dataSourceId: "z" });
  });
});
