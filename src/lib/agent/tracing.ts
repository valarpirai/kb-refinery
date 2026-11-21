import type { ExportResult } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import * as traceloop from "@traceloop/node-server-sdk";
import { PostgresSpanExporter } from "./trace-store";

/** Send each span to several exporters. */
class FanOutExporter implements SpanExporter {
  constructor(private readonly exporters: SpanExporter[]) {}
  export(spans: ReadableSpan[], done: (result: ExportResult) => void): void {
    let pending = this.exporters.length;
    let worst = 0;
    for (const e of this.exporters) {
      e.export(spans, (r) => {
        worst = Math.max(worst, r.code);
        if (--pending === 0) done({ code: worst });
      });
    }
  }
  async shutdown(): Promise<void> {
    await Promise.all(this.exporters.map((e) => e.shutdown()));
  }
}

let started = false;

/**
 * Start Traceloop (OpenLLMetry) once per process.
 * Strands emits the agent, model and tool spans; Traceloop owns the exporter and span processing.
 * Spans always go to the local Postgres store. If TRACELOOP_API_KEY is set,
 * they also go to Traceloop's cloud, or to the OTLP endpoint in TRACELOOP_BASE_URL.
 * Nothing leaves the machine unless you set that key.
 */
export function initTracing(): void {
  if (started) return;
  started = true;
  const exporters: SpanExporter[] = [new PostgresSpanExporter()];
  const apiKey = process.env.TRACELOOP_API_KEY;
  if (apiKey) {
    const base = (process.env.TRACELOOP_BASE_URL ?? "https://api.traceloop.com").replace(/\/$/, "");
    exporters.push(new OTLPTraceExporter({ url: `${base}/v1/traces`, headers: { Authorization: `Bearer ${apiKey}` } }));
    console.log(`[traces] also exporting to ${base}`);
  }
  traceloop.initialize({
    appName: "kb-refinery",
    exporter: new FanOutExporter(exporters),
    disableBatch: true,
    logLevel: "error",
    // Strands already records each model call as a span with token usage. Traceloop's own
    // OpenAI instrumentation would duplicate it and logs "Unknown model" for local models.
  });
}
