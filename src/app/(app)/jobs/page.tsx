import Link from "next/link";
import { StatusPill } from "@/components/status-pill";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const jobs = await db.job.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Jobs</h1>
      {jobs.length === 0 ? (
        <p className="text-sm opacity-70">No jobs yet. Start one from the home page.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-black/10 dark:border-white/15">
              <tr>
                <th className="py-2 pr-4">Scope</th>
                <th className="pr-4">Status</th>
                <th className="pr-4">Articles</th>
                <th className="pr-4">Findings</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-black/5 dark:border-white/10">
                  <td className="py-2 pr-4">
                    <Link href={`/jobs/${j.id}`} className="text-blue-700 hover:underline dark:text-blue-300">{j.scope ?? "Job"}</Link>
                  </td>
                  <td className="pr-4"><StatusPill status={j.status} /></td>
                  <td className="pr-4">{j.articlesProcessed + j.articlesSkipped}/{j.articlesTotal}</td>
                  <td className="pr-4">{j.findingsGenerated}</td>
                  <td>{j.createdAt.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
