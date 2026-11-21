import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArticleRefineButton } from "@/components/article-refine-button";
import { ArticleTags } from "@/components/article-tags";
import { db } from "@/lib/db";
import { MAX_TAGS_PER_ARTICLE } from "@/lib/tags";
import "../articles.css";

export const dynamic = "force-dynamic";

const PREVIEW_CHARS = 3000;

/** True only for http(s) links, so a stored "javascript:" URL is never rendered as a link. */
function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const article = await db.article.findUnique({
    where: { id },
    include: { analysis: { select: { id: true } }, articleTags: { select: { tag: { select: { id: true, name: true } } }, orderBy: { tag: { name: "asc" } } } },
  });
  if (!article) notFound();
  if (article.analysis) redirect(`/analysis/${article.analysis.id}`);

  const url = safeUrl(article.url);
  const preview = article.body.slice(0, PREVIEW_CHARS);

  return (
    <div className="art-root max-w-3xl space-y-5">
      <Link href="/articles" className="text-sm text-blue-700 hover:underline dark:text-blue-300">← Back to articles</Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{article.title}</h1>
        <p className="text-sm opacity-80">Knowledge base: {article.knowledgeBase ?? "None"}</p>
        {url && (
          <p className="text-sm">
            Source: <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-blue-700 underline dark:text-blue-300">{url}</a>
          </p>
        )}
      </header>

      <section aria-labelledby="tags-h" className="space-y-1">
        <h2 id="tags-h" className="text-sm font-medium">Tags</h2>
        <ArticleTags articleId={article.id} initial={article.articleTags.map((t) => t.tag)} />
        <p className="text-xs opacity-70">Lower-case, 1 to 40 characters, up to {MAX_TAGS_PER_ARTICLE} per article. Press Enter or comma to add.</p>
      </section>

      <section aria-labelledby="body-h" className="space-y-1">
        <h2 id="body-h" className="text-sm font-medium">Preview{article.body.length > PREVIEW_CHARS ? ` (first ${PREVIEW_CHARS} characters)` : ""}</h2>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-black/10 p-3 text-sm dark:border-white/15" tabIndex={0}>{preview}</pre>
      </section>

      <div className="space-y-1">
        <p className="text-sm opacity-80">This article has not been refined yet.</p>
        <ArticleRefineButton articleIds={[article.id]} />
      </div>
    </div>
  );
}
