import type { DataSource } from "@/generated/prisma/client";

/**
 * Hide secrets before a data source leaves the server.
 * @param source a data source row
 * @return the row with the auth header replaced by a flag
 */
export function redact(source: DataSource) {
  const { authHeader, ...config } = (source.config ?? {}) as Record<string, unknown>;
  return { ...source, config: { ...config, hasAuthHeader: Boolean(authHeader) } };
}
