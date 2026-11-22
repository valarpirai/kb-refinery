import { describe, expect, it } from "vitest";
import type { DataSource } from "@/generated/prisma/client";
import { redact } from ".././sources";

const make = (config: unknown) => ({ id: "s1", name: "n", config }) as unknown as DataSource;

describe("redact", () => {
  it("replaces the auth header with a flag", () => {
    const out = redact(make({ url: "http://x", authHeader: "Bearer secret" }));
    expect(out.config).toEqual({ url: "http://x", hasAuthHeader: true });
    expect(JSON.stringify(out)).not.toContain("secret");
  });

  it("flags false when there is no or an empty header", () => {
    expect(redact(make({ url: "u" })).config).toEqual({ url: "u", hasAuthHeader: false });
    expect(redact(make({ authHeader: "" })).config).toEqual({ hasAuthHeader: false });
  });

  it("handles a null config and keeps other fields", () => {
    const out = redact(make(null));
    expect(out.config).toEqual({ hasAuthHeader: false });
    expect(out.id).toBe("s1");
  });
});
