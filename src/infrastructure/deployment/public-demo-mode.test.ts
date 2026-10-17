import { afterEach, describe, expect, it } from "vitest";

import { isPublicDemoMode, publicDemoReadOnlyResponse } from "./public-demo-mode";

const originalPublicDemoMode = process.env.PUBLIC_DEMO_MODE;

afterEach(() => {
  if (originalPublicDemoMode === undefined) delete process.env.PUBLIC_DEMO_MODE;
  else process.env.PUBLIC_DEMO_MODE = originalPublicDemoMode;
});

describe("explicit public demo boundary", () => {
  it("keeps demo mode disabled unless explicitly enabled", () => {
    delete process.env.PUBLIC_DEMO_MODE;
    expect(isPublicDemoMode()).toBe(false);

    process.env.PUBLIC_DEMO_MODE = "false";
    expect(isPublicDemoMode()).toBe(false);

    process.env.PUBLIC_DEMO_MODE = "true";
    expect(isPublicDemoMode()).toBe(true);
  });

  it("returns a cache-safe forbidden response before a live operation", async () => {
    process.env.PUBLIC_DEMO_MODE = "true";
    const response = publicDemoReadOnlyResponse("trace-public-demo");

    expect(response?.status).toBe(403);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(await response?.json()).toMatchObject({
      error: { code: "PUBLIC_DEMO_READ_ONLY", trace_id: "trace-public-demo" },
      data_mode: "demo",
    });
  });
});
