import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaimLostError, HEARTBEAT_MS, HEARTBEAT_TIMEOUT_MS, MAX_ATTEMPTS, WORKER_ID } from "./worker-id";

describe("worker-id", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("builds an id from host, pid and a short random suffix", () => {
    expect(WORKER_ID).toContain(`-${process.pid}-`);
    expect(WORKER_ID).toMatch(/-[0-9a-f]{6}$/);
  });

  it("gives a different id to each module load", async () => {
    vi.resetModules();
    const again = await import("./worker-id");
    expect(again.WORKER_ID).not.toBe(WORKER_ID);
  });

  it("has defaults of 15s, 90s and 3 attempts", () => {
    expect(HEARTBEAT_MS).toBe(15_000);
    expect(HEARTBEAT_TIMEOUT_MS).toBe(90_000);
    expect(MAX_ATTEMPTS).toBe(3);
  });

  it("reads timings from the environment", async () => {
    vi.stubEnv("HEARTBEAT_MS", "100");
    vi.stubEnv("HEARTBEAT_TIMEOUT_MS", "500");
    vi.stubEnv("MAX_ATTEMPTS", "7");
    vi.resetModules();
    const m = await import("./worker-id");
    expect([m.HEARTBEAT_MS, m.HEARTBEAT_TIMEOUT_MS, m.MAX_ATTEMPTS]).toEqual([100, 500, 7]);
  });

  it("keeps the heartbeat timeout longer than the heartbeat interval", () => {
    expect(HEARTBEAT_TIMEOUT_MS).toBeGreaterThan(HEARTBEAT_MS);
  });

  it("ClaimLostError is an Error with a fixed message", () => {
    const e = new ClaimLostError();
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("This worker no longer holds the item");
  });
});
