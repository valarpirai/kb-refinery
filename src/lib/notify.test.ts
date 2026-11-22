import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { notification: { create: vi.fn() } } }));

import { db } from "@/lib/db";
import { notify } from "./notify";

const create = () => vi.mocked(db.notification.create);

describe("notify", () => {
  it("does nothing without a user", async () => {
    await notify(null, { title: "x" });
    await notify(undefined, { title: "x" });
    await notify("", { title: "x" });
    expect(create()).not.toHaveBeenCalled();
  });

  it("creates an info notification by default", async () => {
    await notify("u1", { title: "Hi", href: "/x" });
    expect(create()).toHaveBeenCalledWith({ data: { userId: "u1", level: "info", title: "Hi", body: undefined, href: "/x" } });
  });

  it("keeps the given level and body", async () => {
    await notify("u1", { level: "error", title: "T", body: "B" });
    expect(create().mock.calls[0][0].data).toMatchObject({ level: "error", body: "B" });
  });

  it("cuts long titles to 200 and bodies to 1000 characters", async () => {
    await notify("u1", { title: "t".repeat(300), body: "b".repeat(2000) });
    const data = create().mock.calls[0][0].data as { title: string; body: string };
    expect(data.title).toHaveLength(200);
    expect(data.body).toHaveLength(1000);
  });

  it("swallows database errors and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    create().mockRejectedValueOnce(new Error("db down"));
    await expect(notify("u1", { title: "T" })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[notify]", "db down");
  });
});
