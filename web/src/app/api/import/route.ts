import { NextResponse } from "next/server";
import { runImport } from "@/lib/ingest/import";
import type { UploadKind } from "@/lib/ingest/types";

export const runtime = "nodejs";

const MAX_FILES = 200;
const MAX_BYTES = 10 * 1024 * 1024;

/** POST multipart form: `kind` ("articles" | "incidents") and one or more `files`. */
export async function POST(req: Request) {
  const form = await req.formData();
  const kind = form.get("kind");
  if (kind !== "articles" && kind !== "incidents") {
    return NextResponse.json({ error: "kind must be 'articles' or 'incidents'" }, { status: 400 });
  }
  const uploads = form.getAll("files").filter((f): f is File => f instanceof File);
  if (uploads.length === 0) return NextResponse.json({ error: "no files" }, { status: 400 });
  if (uploads.length > MAX_FILES) return NextResponse.json({ error: `max ${MAX_FILES} files` }, { status: 413 });
  const tooBig = uploads.find((f) => f.size > MAX_BYTES);
  if (tooBig) return NextResponse.json({ error: `${tooBig.name} exceeds 10 MB` }, { status: 413 });

  const files = await Promise.all(uploads.map(async (f) => ({ name: f.name, text: await f.text() })));
  const run = await runImport({ kind: kind as UploadKind, files });
  return NextResponse.json(run);
}
