// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { restartItem, STAGE_LABEL } from "./pipeline-restart";

/**
 * Stub fetch with a response.
 * @param status http status
 * @param body json body, or undefined for a body that fails to parse
 */
function stub(status: number, body?: unknown) {
  const f = vi.fn().mockResolvedValue({ status, json: async () => { if (body === undefined) throw new Error("bad json"); return body; } });
  vi.stubGlobal("fetch", f);
  return f;
}

describe("restartItem", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("posts the stage and returns null on 202", async () => {
    const f = stub(202, {});
    expect(await restartItem("i1", "analyze")).toBeNull();
    expect(f).toHaveBeenCalledWith("/api/job-items/i1/restart", expect.objectContaining({ method: "POST", body: JSON.stringify({ fromStage: "analyze" }) }));
  });

  it("returns the server's error message", async () => {
    stub(409, { error: "Already running" });
    expect(await restartItem("i1", "convert")).toBe("Already running");
  });

  it("falls back to the status when there is no message", async () => {
    stub(500, {});
    expect(await restartItem("i1", "convert")).toBe("Restart failed (HTTP 500).");
  });

  it("falls back to the status when the body is not JSON", async () => {
    stub(502);
    expect(await restartItem("i1", "convert")).toBe("Restart failed (HTTP 502).");
  });

  it("returns a network message when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await restartItem("i1", "convert")).toBe("Could not reach the server. Try again.");
  });
});

describe("STAGE_LABEL", () => {
  it("names every restartable stage", () => {
    expect(STAGE_LABEL).toEqual({ convert: "Convert", analyze: "Analyze", enrich: "Enrich", rewrite: "Rewrite" });
  });
});
