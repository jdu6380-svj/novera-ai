import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET as getDocument } from "./documents/[id]/route";
import { POST as completeDocument } from "./documents/[id]/complete/route";
import { POST as processDocument } from "./documents/[id]/process/route";
import { POST as initializeDocument } from "./documents/init/route";
import { GET as getProcessingJob } from "./processing-jobs/[id]/route";
import { POST as retryProcessingJob } from "./processing-jobs/[id]/retry/route";
import { POST as createQaRun } from "./qa/runs/route";
import { POST as queryRetrieval } from "./retrieval/query/route";
import { GET as getWorkspace } from "./workspace/route";

const originalPublicDemoMode = process.env.PUBLIC_DEMO_MODE;

function routeParams(id = "00000000-0000-4000-8000-000000000001") {
  return { params: Promise.resolve({ id }) };
}

async function expectPublicReadOnly(response: Response): Promise<void> {
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    error: { code: "PUBLIC_DEMO_READ_ONLY" },
    data_mode: "demo",
  });
}

afterEach(() => {
  if (originalPublicDemoMode === undefined) delete process.env.PUBLIC_DEMO_MODE;
  else process.env.PUBLIC_DEMO_MODE = originalPublicDemoMode;
});

describe("explicit public demo route boundary", () => {
  it("blocks every live document, processing, retrieval, and QA operation", async () => {
    process.env.PUBLIC_DEMO_MODE = "true";
    const request = new Request("https://novera.example/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not parsed in public demo mode",
    });

    const responses = await Promise.all([
      initializeDocument(request),
      completeDocument(request, routeParams()),
      processDocument(request, routeParams()),
      getDocument(new Request("https://novera.example/api"), routeParams()),
      getProcessingJob(new Request("https://novera.example/api"), routeParams()),
      retryProcessingJob(request, routeParams()),
      queryRetrieval(request),
      createQaRun(request),
    ]);

    for (const response of responses) await expectPublicReadOnly(response);
  });

  it("keeps the preset workspace readable without a live database", async () => {
    process.env.PUBLIC_DEMO_MODE = "true";

    const response = await getWorkspace(new Request("https://novera.example/api/v1/workspace"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data_mode: "demo",
      knowledge_base: { name: "Asteria Workcloud · 演示知识库" },
    });
  });
});
