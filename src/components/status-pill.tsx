import { label, statusClass } from "@/lib/format";

/** Small colored pill showing a status. Color is never the only signal; the text is always shown. */
export function StatusPill({ status }: { status: string }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(status)}`}>{label(status)}</span>;
}
