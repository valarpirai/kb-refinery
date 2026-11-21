import { notFound } from "next/navigation";
import { JobProgress, type JobData } from "@/components/job-progress";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await db.job.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: [{ batchNumber: "asc" }, { updatedAt: "asc" }],
        include: { article: { select: { id: true, title: true, knowledgeBase: true } }, analysis: { select: { id: true, pipelineStage: true } } },
      },
    },
  });
  if (!job) notFound();
  // Dates are not JSON-safe across the server/client boundary; the client only needs plain fields.
  return <JobProgress initial={JSON.parse(JSON.stringify(job)) as JobData} />;
}
