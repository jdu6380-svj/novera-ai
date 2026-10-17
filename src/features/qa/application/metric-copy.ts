import type { WorkspaceMetric } from "@/features/workspace/domain/workspace";

const LABELS: Record<WorkspaceMetric["key"], string> = {
  retrieval: "检索质量",
  coverage: "证据覆盖率",
  match: "知识匹配度",
  confidence: "回答置信度",
};

export function metricLabel(key: WorkspaceMetric["key"], fallback?: string): string {
  return LABELS[key] ?? fallback ?? "质量指标";
}

export function metricExplanation(explanation: string): string {
  const retrieval = explanation.match(
    /^Selected (\d+) evidence chunks with average similarity ([\d.]+) across (\d+) source document\(s\)\.$/,
  );
  if (retrieval) {
    return `已从 ${retrieval[3]} 个来源文档中选取 ${retrieval[1]} 个证据片段，平均相似度为 ${retrieval[2]}。`;
  }

  const coverage = explanation.match(
    /^([\d.]+) of ([\d.]+) weighted claim points are supported by verified evidence\.$/,
  );
  if (coverage) {
    return `已验证证据支持 ${coverage[1]} / ${coverage[2]} 个加权结论点。`;
  }

  switch (explanation) {
    case "The generated answer contains no verifiable claims.":
      return "生成的回答不包含可验证的结论。";
    case "Retrieved knowledge only partially supports the requested answer, so the score is conservatively capped by a sufficiency penalty.":
      return "检索到的知识只能部分支持当前回答，因此评分因证据充分性不足而保守封顶。";
    case "Knowledge match combines retrieval relevance with claim-level evidence coverage.":
      return "知识匹配度综合考虑检索相关性和结论级证据覆盖情况。";
    case "Confidence is capped below 50 because the final Evidence Layer result is insufficient.":
      return "由于最终证据层结果不足，回答置信度被限制在 50 分以下。";
    case "Confidence conservatively combines retrieval, evidence coverage, knowledge match, and unsupported-evidence penalties.":
      return "回答置信度综合考虑检索、证据覆盖、知识匹配和未获支持证据等因素，并采用保守计算。";
    case "This score is calculated from retrieval relevance and verified evidence coverage.":
      return "该评分根据检索相关性和已验证证据覆盖情况计算。";
    case "No explanation was returned.":
      return "暂无评分说明。";
    case "No QA run yet.":
      return "尚未执行问答评测。";
    default:
      return explanation;
  }
}
