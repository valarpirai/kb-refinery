import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDuration, spanLabel } from "@/lib/agent/trace-format";
import { db } from "@/lib/db";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type Attrs = Record<string, unknown>;

/** Attributes worth showing first, in this order. The rest follow in a collapsed block. */
const KEY_ATTRS = ["gen_ai.tool.name", "gen_ai.tool.status", "gen_ai.request.model", "gen_ai.usage.input_tokens", "gen_ai.usage.output_tokens", "gen_ai.usage.total_tokens", "gen_ai.response.finish_reasons"];
const BODY_ATTRS = ["gen_ai.input.messages", "gen_ai.output.messages", "gen_ai.tool.definitions", "system_prompt"];

/** Pretty-print a stored attribute. JSON strings are re-indented. */
function show(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

export default async function TracePage({ params }: { params: Promise<{ traceId: string }> }) {
  const user = await requirePageUser();
  if (user.role !== "admin") notFound();
  const { traceId } = await params;

  const spans = await db.traceSpan.findMany({ where: { traceId }, orderBy: { startedAt: "asc" } });
  if (spans.length === 0) notFound();

  const t0 = spans[0].startedAt.getTime();
  const end = Math.max(...spans.map((s) => s.startedAt.getTime() + s.durationMs));
  const total = Math.max(end - t0, 1);

  const ids = new Set(spans.map((s) => s.spanId));
  const children = new Map<string | null, typeof spans>();
  for (const s of spans) {
    const key = s.parentId && ids.has(s.parentId) ? s.parentId : null;
    children.set(key, [...(children.get(key) ?? []), s]);
  }
  const ordered: { span: (typeof spans)[number]; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const s of children.get(parent) ?? []) {
      ordered.push({ span: s, depth });
      walk(s.spanId, depth + 1);
    }
  };
  walk(null, 0);

  const agent = spans.find((s) => s.name.startsWith("invoke_agent"));
  const tokens = agent ? Number((agent.attributes as Attrs)["gen_ai.usage.total_tokens"] ?? 0) : 0;
  const errors = spans.filter((s) => s.status === "error").length;
  const conversationId = String(spans.map((s) => (s.attributes as Attrs)["kb.conversation_id"]).find(Boolean) ?? "");
  const mine = conversationId ? await db.conversation.findFirst({ where: { id: conversationId, userId: user.id }, select: { id: true } }) : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/traces" className="text-sm text-blue-700 hover:underline dark:text-blue-300">← All traces</Link>
        <h1 className="mt-2 text-2xl font-semibold">{agent ? "Agent run" : spanLabel(ordered[0].span.name)}</h1>
        <p className="mt-1 font-mono text-xs opacity-70">{traceId}</p>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
        {([
          ["Started", spans[0].startedAt.toLocaleString()],
          ["Total time", formatDuration(total)],
          ["Spans", String(spans.length)],
          ["Tokens", tokens ? tokens.toLocaleString() : "–"],
          ["Errors", String(errors)],
        ] as const).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-black/10 p-3 dark:border-white/15">
            <dt className="text-xs opacity-70">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {mine && <p className="text-sm"><Link href={`/chat?c=${mine.id}`} className="text-blue-700 underline dark:text-blue-300">Open the chat conversation</Link></p>}

      <section aria-labelledby="timeline">
        <h2 id="timeline" className="mb-3 text-lg font-medium">Timeline</h2>
        <ol className="space-y-1">
          {ordered.map(({ span, depth }) => {
            const attrs = span.attributes as Attrs;
            const offset = ((span.startedAt.getTime() - t0) / total) * 100;
            const width = Math.max((span.durationMs / total) * 100, 0.4);
            const bad = span.status === "error";
            const key = KEY_ATTRS.filter((k) => attrs[k] !== undefined);
            const bodies = BODY_ATTRS.filter((k) => attrs[k] !== undefined);
            const rest = Object.keys(attrs).filter((k) => !KEY_ATTRS.includes(k) && !BODY_ATTRS.includes(k)).sort();
            return (
              <li key={span.spanId} style={{ marginLeft: `${Math.min(depth, 6) * 14}px` }}>
                <details className="rounded border border-black/10 dark:border-white/15">
                  <summary className="grid cursor-pointer grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{spanLabel(span.name)}{bad && <span className="ml-2 text-red-700 dark:text-red-300">· error</span>}</span>
                      <span className="mt-1 block h-1.5 rounded bg-black/5 dark:bg-white/10" aria-hidden="true">
                        <span className={`block h-full rounded ${bad ? "bg-red-600" : "bg-blue-600"}`} style={{ marginLeft: `${offset}%`, width: `${width}%` }} />
                      </span>
                    </span>
                    <span className="text-right text-xs tabular-nums">{formatDuration(span.durationMs)}</span>
                  </summary>
                  <div className="space-y-3 border-t border-black/10 p-3 text-xs dark:border-white/15">
                    <p className="font-mono opacity-70">{span.name}</p>
                    {key.length > 0 && (
                      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                        {key.map((k) => (<div key={k} className="contents"><dt className="opacity-70">{k}</dt><dd>{String(attrs[k])}</dd></div>))}
                      </dl>
                    )}
                    {bodies.map((k) => (
                      <div key={k}>
                        <p className="mb-1 font-medium">{k}</p>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-black/5 p-2 dark:bg-white/10">{show(attrs[k])}</pre>
                      </div>
                    ))}
                    {rest.length > 0 && (
                      <details>
                        <summary className="cursor-pointer opacity-70">Other attributes ({rest.length})</summary>
                        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words">{rest.map((k) => `${k}: ${typeof attrs[k] === "string" ? attrs[k] : JSON.stringify(attrs[k])}`).join("\n")}</pre>
                      </details>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
