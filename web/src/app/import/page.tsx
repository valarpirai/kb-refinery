import { UploadForm } from "@/components/upload-form";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const runs = await db.importRun.findMany({ orderBy: { startedAt: "desc" }, take: 20 });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Import</h1>
        <p className="mt-1 text-sm opacity-70">Upload articles or incidents to refine.</p>
      </div>
      <UploadForm />
      <section aria-labelledby="history">
        <h2 id="history" className="mb-3 text-lg font-medium">
          Import history
        </h2>
        {runs.length === 0 ? (
          <p className="text-sm opacity-70">Nothing imported yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-black/10 dark:border-white/15">
              <tr>
                <th className="py-2 pr-4">Source</th>
                <th className="pr-4">Status</th>
                <th className="pr-4">Created</th>
                <th className="pr-4">Updated</th>
                <th className="pr-4">Unchanged</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-black/5 dark:border-white/10">
                  <td className="py-2 pr-4">{r.label}</td>
                  <td className="pr-4">{r.status.replace(/_/g, " ")}</td>
                  <td className="pr-4">{r.created}</td>
                  <td className="pr-4">{r.updated}</td>
                  <td className="pr-4">{r.skipped}</td>
                  <td>{r.startedAt.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
