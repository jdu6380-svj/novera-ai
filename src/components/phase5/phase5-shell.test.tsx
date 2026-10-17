import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { demoWorkspaceData } from "./demo-data";
import { Phase5Workspace } from "./phase5-shell";

describe("Phase 5 evidence-first presentation", () => {
  it("does not label an insufficient-evidence answer as verified", () => {
    const markup = renderToStaticMarkup(
      <Phase5Workspace
        data={{
          ...demoWorkspaceData,
          answer: {
            ...demoWorkspaceData.answer,
            insufficientEvidence: true,
            claims: [
              {
                ...demoWorkspaceData.answer.claims[0]!,
                supportStatus: "unsupported",
                evidenceIds: [],
              },
            ],
            evidence: [],
          },
        }}
      />,
    );

    expect(markup).toContain("Review evidence coverage");
    expect(markup).toContain("Insufficient evidence");
    expect(markup).not.toContain("Verified against sources");
  });

  it("uses product-facing labels for task types", () => {
    const markup = renderToStaticMarkup(<Phase5Workspace />);

    expect(markup).toContain(">Analysis<");
    expect(markup).toContain(">Comparison<");
    expect(markup).toContain(">Recommendation<");
    expect(markup).not.toContain("analysis analysis");
  });
});
