import type { Prisma } from "@/generated/prisma/client";
import type { ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { db } from "@/lib/db";

const MAX_ATTR_CHARS = 8000;

/** Convert an OpenTelemetry high-resolution time pair to milliseconds. */
function hrToMs([seconds, nanos]: [number, number]): number {
  return seconds * 1000 + nanos / 1e6;
}

/**
 * Keep attributes small enough to store. Long strings, such as whole prompts, are cut.
 * @param attrs span attributes
 * @return a JSON-safe copy
 */
function clean(attrs: ReadableSpan["attributes"]): Prisma.InputJsonObject {
  const out: Record<string, Prisma.InputJsonValue> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    if (typeof v === "string") out[k] = v.length > MAX_ATTR_CHARS ? `${v.slice(0, MAX_ATTR_CHARS)}… [cut]` : v;
    else out[k] = v as Prisma.InputJsonValue;
  }
  return out;
}

/**
 * Span exporter that saves every span to the TraceSpan table.
 * This keeps agent traces on your own machine and lets the app show them.
 */
export class PostgresSpanExporter implements SpanExporter {
  export(spans: ReadableSpan[], done: (result: ExportResult) => void): void {
    db.traceSpan
      .createMany({
        skipDuplicates: true,
        data: spans.map((s) => ({
          spanId: s.spanContext().spanId,
          traceId: s.spanContext().traceId,
          parentId: s.parentSpanContext?.spanId ?? null,
          name: s.name,
          startedAt: new Date(hrToMs(s.startTime as [number, number])),
          durationMs: hrToMs(s.duration as [number, number]),
          status: s.status.code === 2 ? "error" : "ok",
          attributes: clean(s.attributes),
        })),
      })
      .then(() => done({ code: 0 }))
      .catch((e) => {
        console.warn("[traces] could not save spans:", (e as Error).message);
        done({ code: 1 });
      });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
