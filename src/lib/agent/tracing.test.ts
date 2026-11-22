import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const initialize = vi.fn();
const otlp = vi.fn();
const pgExport = vi.fn();
const pgShutdown = vi.fn(async () => {});
const otlpExport = vi.fn();
const otlpShutdown = vi.fn(async () => {});

vi.mock("@traceloop/node-server-sdk", () => ({ initialize: (o: unknown) => initialize(o) }));
vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: class {
    constructor(o: unknown) {
      otlp(o);
    }
    export = otlpExport;
    shutdown = otlpShutdown;
  },
}));
vi.mock("./trace-store", () => ({
  PostgresSpanExporter: class {
    export = pgExport;
    shutdown = pgShutdown;
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("TRACELOOP_API_KEY", "");
  delete process.env.TRACELOOP_API_KEY;
  delete process.env.TRACELOOP_BASE_URL;
});
afterEach(() => vi.unstubAllEnvs());

const load = async () => (await import("./tracing")).initTracing;

describe("initTracing", () => {
  it("starts Traceloop once with the local store only by default", async () => {
    const initTracing = await load();
    initTracing();
    initTracing();
    expect(initialize).toHaveBeenCalledOnce();
    expect(initialize.mock.calls[0][0]).toMatchObject({ appName: "kb-refinery", disableBatch: true });
    expect(otlp).not.toHaveBeenCalled();
  });

  it("adds a cloud exporter when an API key is set", async () => {
    vi.stubEnv("TRACELOOP_API_KEY", "k");
    vi.spyOn(console, "log").mockImplementation(() => {});
    (await load())();
    expect(otlp).toHaveBeenCalledWith({ url: "https://api.traceloop.com/v1/traces", headers: { Authorization: "Bearer k" } });
  });

  it("uses a custom base URL without a trailing slash", async () => {
    vi.stubEnv("TRACELOOP_API_KEY", "k");
    vi.stubEnv("TRACELOOP_BASE_URL", "https://otel.example.com/");
    vi.spyOn(console, "log").mockImplementation(() => {});
    (await load())();
    expect(otlp.mock.calls[0][0].url).toBe("https://otel.example.com/v1/traces");
  });

  describe("fan-out exporter", () => {
    async function exporter() {
      vi.stubEnv("TRACELOOP_API_KEY", "k");
      vi.spyOn(console, "log").mockImplementation(() => {});
      (await load())();
      return initialize.mock.calls[0][0].exporter as { export: (s: unknown[], d: (r: { code: number }) => void) => void; shutdown: () => Promise<void> };
    }

    it("sends spans to every exporter and reports once when all finish", async () => {
      pgExport.mockImplementation((_s, done) => done({ code: 0 }));
      otlpExport.mockImplementation((_s, done) => done({ code: 0 }));
      const done = vi.fn();
      const spans = [{}];
      (await exporter()).export(spans, done);
      expect(pgExport.mock.calls[0][0]).toBe(spans);
      expect(otlpExport.mock.calls[0][0]).toBe(spans);
      expect(done).toHaveBeenCalledOnce();
      expect(done).toHaveBeenCalledWith({ code: 0 });
    });

    it("reports the worst result code", async () => {
      pgExport.mockImplementation((_s, done) => done({ code: 0 }));
      otlpExport.mockImplementation((_s, done) => done({ code: 1 }));
      const done = vi.fn();
      (await exporter()).export([], done);
      expect(done).toHaveBeenCalledWith({ code: 1 });
    });

    it("waits for a slow exporter", async () => {
      let finish: (r: { code: number }) => void = () => {};
      pgExport.mockImplementation((_s, done) => done({ code: 0 }));
      otlpExport.mockImplementation((_s, done) => (finish = done));
      const done = vi.fn();
      (await exporter()).export([], done);
      expect(done).not.toHaveBeenCalled();
      finish({ code: 0 });
      expect(done).toHaveBeenCalledOnce();
    });

    it("shuts down every exporter", async () => {
      await (await exporter()).shutdown();
      expect(pgShutdown).toHaveBeenCalled();
      expect(otlpShutdown).toHaveBeenCalled();
    });
  });
});
