import { afterEach } from "vitest";

// Component tests opt in to jsdom with a "@vitest-environment jsdom" docblock.
// Node-only tests skip the DOM setup below.
if (typeof document !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  const { cleanup } = await import("@testing-library/react");
  afterEach(() => cleanup());
}
