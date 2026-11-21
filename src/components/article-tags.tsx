"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_TAGS_PER_ARTICLE } from "@/lib/tags";

export interface TagItem {
  id: string;
  name: string;
}

let tagCache: string[] | null = null;

/**
 * Editable tag chips for one article. Changes are applied at once and rolled back if the server says no.
 * @param articleId the article
 * @param initial its current tags
 * @param refresh refresh server data after a change, so tag counts and filters update
 */
export function ArticleTags({ articleId, initial, refresh = false }: { articleId: string; initial: TagItem[]; refresh?: boolean }) {
  const router = useRouter();
  const [tags, setTags] = useState<TagItem[]>(initial);
  const [leaving, setLeaving] = useState<string[]>([]);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [options, setOptions] = useState<string[]>(tagCache ?? []);
  const loading = useRef(false);
  const listId = useId();
  const hintId = useId();

  /** Fetch the existing tag names once, the first time the input is focused. */
  async function loadOptions() {
    if (tagCache || loading.current) return;
    loading.current = true;
    try {
      const res = await fetch("/api/tags");
      if (res.ok) {
        const all = (await res.json()) as { name: string }[];
        tagCache = all.map((t) => t.name);
        setOptions(tagCache);
      }
    } finally {
      loading.current = false;
    }
  }

  async function add(raw: string) {
    const name = raw.trim().replace(/\s+/g, " ").toLowerCase();
    setValue("");
    if (!name) return;
    setError("");
    if (name.length > 40) return setError("A tag is 1 to 40 characters.");
    if (tags.some((t) => t.name === name)) return;
    if (tags.length >= MAX_TAGS_PER_ARTICLE) return setError(`An article can have up to ${MAX_TAGS_PER_ARTICLE} tags.`);
    const temp: TagItem = { id: `tmp:${name}`, name };
    setTags((prev) => [...prev, temp]);
    try {
      const res = await fetch(`/api/articles/${articleId}/tags`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const data = (await res.json().catch(() => ({}))) as Partial<TagItem> & { error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Could not add the tag.");
      setTags((prev) => prev.map((t) => (t.id === temp.id ? { id: data.id!, name: data.name ?? name } : t)));
      if (tagCache && !tagCache.includes(name)) tagCache = [...tagCache, name];
      if (refresh) router.refresh();
    } catch (e) {
      setTags((prev) => prev.filter((t) => t.id !== temp.id));
      setError((e as Error).message);
    }
  }

  async function remove(tag: TagItem) {
    if (tag.id.startsWith("tmp:")) return;
    setError("");
    setLeaving((l) => [...l, tag.id]);
    const gone = new Promise((r) => setTimeout(r, 150));
    try {
      const res = await fetch(`/api/articles/${articleId}/tags/${tag.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Could not remove the tag.");
      }
      await gone;
      setTags((prev) => prev.filter((t) => t.id !== tag.id));
      setLeaving((l) => l.filter((id) => id !== tag.id));
      if (refresh) router.refresh();
    } catch (e) {
      setLeaving((l) => l.filter((id) => id !== tag.id));
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-wrap items-center gap-1" aria-label="Tags">
        {tags.map((t) => (
          <li key={t.id} data-leaving={leaving.includes(t.id)} className="art-chip inline-flex items-center gap-1 rounded-full bg-gray-100 py-0.5 pl-2 pr-1 text-xs dark:bg-gray-800">
            <span>{t.name}</span>
            <button type="button" aria-label={`Remove tag ${t.name}`} onClick={() => remove(t)} className="art-hover art-press inline-flex size-5 items-center justify-center rounded-full">
              <span aria-hidden="true">×</span>
            </button>
          </li>
        ))}
        <li>
          <input
            type="text"
            value={value}
            list={listId}
            maxLength={41}
            aria-label="Add tag"
            aria-describedby={hintId}
            placeholder="Add tag"
            onFocus={loadOptions}
            onChange={(e) => {
              const v = e.target.value;
              if (v.includes(",")) {
                const parts = v.split(",");
                setValue(parts[parts.length - 1]);
                parts.slice(0, -1).forEach((p) => void add(p));
              } else setValue(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add(value);
              }
            }}
            className="w-24 rounded border border-black/15 bg-transparent px-1.5 py-0.5 text-xs dark:border-white/20"
          />
          <datalist id={listId}>
            {options.filter((o) => !tags.some((t) => t.name === o)).map((o) => <option key={o} value={o} />)}
          </datalist>
        </li>
      </ul>
      <span id={hintId} className="sr-only">Press Enter or comma to add. Tags are lower-case, 1 to 40 characters, up to {MAX_TAGS_PER_ARTICLE} per article.</span>
      <span aria-live="polite" role="status" className="min-h-0 text-xs text-red-700 dark:text-red-300">{error}</span>
    </div>
  );
}
