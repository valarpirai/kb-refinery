export type ArticleFormat = "md" | "html" | "csv" | "json" | "text";

/** One article parsed out of an uploaded file, before it is written to the database. */
export interface ParsedArticle {
  externalId?: string;
  title: string;
  body: string;
  format: Exclude<ArticleFormat, "csv" | "json">;
  knowledgeBase?: string;
  url?: string;
  sourceUpdatedAt?: Date;
  metadata?: Record<string, unknown>;
}

/** One incident parsed out of an uploaded file. */
export interface ParsedIncident {
  number: string;
  shortDescription: string;
  description?: string;
  resolution?: string;
  category?: string;
  openedAt?: Date;
}

export type UploadKind = "articles" | "incidents";

export interface ParseResult<T> {
  items: T[];
  errors: string[];
}
