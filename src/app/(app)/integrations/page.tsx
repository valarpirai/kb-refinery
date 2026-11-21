import { SourceActions } from "@/components/source-actions";
import { SourceForm } from "@/components/source-form";
import { StatusPill } from "@/components/status-pill";
import { db } from "@/lib/db";
import { label } from "@/lib/format";

export const dynamic = "force-dynamic";

const TYPE_NAME: Record<string, string> = { rest_json: "REST / JSON", url_crawl: "Web pages" };

export default async function IntegrationsPage() {
  const sources = await db.dataSource.findMany({ orderBy: { createdAt: "desc" } });
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Integrations</h1>
        <p className="mt-1 text-sm opacity-70">Connect a source. The worker pulls it on a schedule and imports what it finds.</p>
      </div>
      <SourceForm />
      <section aria-labelledby="sources">
        <h2 id="sources" className="mb-3 text-lg font-medium">Sources</h2>
        {sources.length === 0 ? (
          <p className="text-sm opacity-70">No sources yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-black/10 dark:border-white/15">
                <tr><th className="py-2 pr-4">Name</th><th className="pr-4">Type</th><th className="pr-4">Schedule</th><th className="pr-4">Last run</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id} className="border-b border-black/5 align-top dark:border-white/10">
                    <td className="py-2 pr-4">{s.name}{!s.enabled && <span className="ml-2 text-xs opacity-70">(paused)</span>}</td>
                    <td className="pr-4">{TYPE_NAME[s.type] ?? label(s.type)}</td>
                    <td className="pr-4 font-mono text-xs">{s.cron ?? "Manual"}</td>
                    <td className="pr-4">
                      {s.lastStatus ? <StatusPill status={s.lastStatus} /> : <span className="opacity-70">Never</span>}
                      {s.lastRunAt && <span className="block text-xs opacity-70">{s.lastRunAt.toLocaleString()}</span>}
                      {s.lastMessage && <span className="block max-w-xs text-xs opacity-80">{s.lastMessage}</span>}
                    </td>
                    <td><SourceActions id={s.id} enabled={s.enabled} name={s.name} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
