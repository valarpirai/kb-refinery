// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A stand-in EventSource that tests drive by hand. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

/**
 * Load a fresh copy of the module, since it keeps one shared stream in module state.
 * @return the useLive hook
 */
async function fresh() {
  vi.resetModules();
  return (await import("./use-live")).useLive;
}

describe("useLive", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens one stream to /api/events and shares it between callers", async () => {
    const useLive = await fresh();
    renderHook(() => useLive(() => {}));
    renderHook(() => useLive(() => {}));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("/api/events");
  });

  it("passes parsed events to every handler", async () => {
    const useLive = await fresh();
    const a = vi.fn();
    const b = vi.fn();
    renderHook(() => useLive(a));
    renderHook(() => useLive(b));
    FakeEventSource.instances[0].onmessage?.({ data: JSON.stringify({ t: "Job", id: "j1" }) });
    expect(a).toHaveBeenCalledWith({ t: "Job", id: "j1" });
    expect(b).toHaveBeenCalledWith({ t: "Job", id: "j1" });
  });

  it("ignores messages that are not JSON", async () => {
    const useLive = await fresh();
    const h = vi.fn();
    renderHook(() => useLive(h));
    FakeEventSource.instances[0].onmessage?.({ data: "not json" });
    expect(h).not.toHaveBeenCalled();
  });

  it("does not call handlers on the first open, but sends null after a reconnect", async () => {
    const useLive = await fresh();
    const h = vi.fn();
    renderHook(() => useLive(h));
    const s = FakeEventSource.instances[0];
    s.onopen?.();
    expect(h).not.toHaveBeenCalled();
    s.onopen?.();
    expect(h).toHaveBeenCalledWith(null);
  });

  it("calls the latest handler after a re-render", async () => {
    const useLive = await fresh();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ h }) => useLive(h), { initialProps: { h: first } });
    rerender({ h: second });
    FakeEventSource.instances[0].onmessage?.({ data: JSON.stringify({ t: "Article" }) });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not open a stream when inactive", async () => {
    const useLive = await fresh();
    renderHook(() => useLive(() => {}, false));
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("closes the stream when the last listener leaves, and not before", async () => {
    const useLive = await fresh();
    const one = renderHook(() => useLive(() => {}));
    const two = renderHook(() => useLive(() => {}));
    const s = FakeEventSource.instances[0];
    one.unmount();
    expect(s.closed).toBe(false);
    two.unmount();
    expect(s.closed).toBe(true);
  });

  it("opens a new stream after the old one closed", async () => {
    const useLive = await fresh();
    renderHook(() => useLive(() => {})).unmount();
    renderHook(() => useLive(() => {}));
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it("stops and starts listening when active toggles", async () => {
    const useLive = await fresh();
    const h = vi.fn();
    const { rerender } = renderHook(({ on }) => useLive(h, on), { initialProps: { on: true } });
    const s = FakeEventSource.instances[0];
    rerender({ on: false });
    expect(s.closed).toBe(true);
    rerender({ on: true });
    expect(FakeEventSource.instances).toHaveLength(2);
  });
});
