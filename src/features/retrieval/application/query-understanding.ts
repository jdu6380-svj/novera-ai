import type {
  JsonObject,
  TaskType,
  TaskUnderstandingResult as DomainTaskUnderstandingResult,
  UnderstoodTaskType,
} from "@/domain";

export interface UnderstandQueryInput {
  query: string;
  requestedTaskType?: TaskType;
}

export interface QueryUnderstandingSignal {
  id: string;
  taskType: UnderstoodTaskType;
  matchedText: string;
  weight: number;
}

export interface QueryUnderstandingResult
  extends DomainTaskUnderstandingResult {
  normalizedQuery: string;
  signals: QueryUnderstandingSignal[];
}

export type QueryUnderstandingErrorCode = "EMPTY_QUERY";

export class QueryUnderstandingError extends Error {
  constructor(
    readonly code: QueryUnderstandingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "QueryUnderstandingError";
  }
}

interface IntentRule {
  id: string;
  taskType: UnderstoodTaskType;
  pattern: RegExp;
  weight: number;
}

const CLASSIFIER_NAME = "novera-task-understanding-rules";
const CLASSIFIER_VERSION = "1.0.0";

const TASK_TIE_BREAK_PRIORITY: readonly UnderstoodTaskType[] = [
  "compare",
  "recommend",
  "analysis",
  "summary",
  "qa",
];

const INTENT_RULES: readonly IntentRule[] = [
  {
    id: "compare-explicit",
    taskType: "compare",
    pattern:
      /\b(?:compare|comparison|contrast|differentiate)\b|比较|对比|异同/u,
    weight: 4,
  },
  {
    id: "compare-versus",
    taskType: "compare",
    pattern: /\b(?:versus|vs\.?)\b|相比|相较/u,
    weight: 3.8,
  },
  {
    id: "compare-difference",
    taskType: "compare",
    pattern:
      /\b(?:difference|differences|trade-?offs?|pros\s+and\s+cons)\b|区别|差异|优劣|取舍/u,
    weight: 3.5,
  },
  {
    id: "recommend-explicit",
    taskType: "recommend",
    pattern:
      /\b(?:recommend|recommendation|recommendations|suggest|suggestion|suggestions|advise|advice)\b|建议|推荐/u,
    weight: 4,
  },
  {
    id: "recommend-action",
    taskType: "recommend",
    pattern:
      /\b(?:should|best\s+practices?|action\s+plans?|next\s+steps?)\b|应该|怎么办|如何改进|最佳实践|优化方案|行动方案|下一步/u,
    weight: 3.4,
  },
  {
    id: "analysis-explicit",
    taskType: "analysis",
    pattern: /\b(?:analysis|analyze|analyse|diagnose|diagnosis)\b|分析|诊断|洞察/u,
    weight: 4,
  },
  {
    id: "analysis-cause",
    taskType: "analysis",
    pattern:
      /\b(?:why|root\s+causes?|causes?|reasons?|drivers?)\b|为什么|为何|原因|根因|成因/u,
    weight: 3.7,
  },
  {
    id: "analysis-pattern",
    taskType: "analysis",
    pattern: /\b(?:impact|impacts|trend|trends|pattern|patterns)\b|影响|趋势|规律/u,
    weight: 2.8,
  },
  {
    id: "summary-explicit",
    taskType: "summary",
    pattern:
      /\b(?:summary|summarize|summarise|recap|synopsis)\b|总结|概括|摘要|归纳|综述/u,
    weight: 4,
  },
  {
    id: "summary-overview",
    taskType: "summary",
    pattern: /\b(?:overview|key\s+takeaways?|main\s+points?)\b|要点|主要内容/u,
    weight: 3.4,
  },
  {
    id: "qa-interrogative",
    taskType: "qa",
    pattern:
      /^(?:what|who|where|when|which|how|is|are|can|could|does|do)\b|^(?:什么|谁|哪里|何时|哪个|哪些|是否|能否|可以吗)/u,
    weight: 1.5,
  },
  {
    id: "qa-question-mark",
    taskType: "qa",
    pattern: /[?？]/u,
    weight: 0.8,
  },
];

function round(value: number, decimals = 4): number {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Produces a stable query representation for rules, embedding, logging, and
 * cache keys without changing the user's wording or removing punctuation.
 */
export function normalizeUserQuery(query: string): string {
  return query.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function emptyIntentScores(): Record<UnderstoodTaskType, number> {
  return {
    qa: 0,
    summary: 0,
    analysis: 0,
    compare: 0,
    recommend: 0,
  };
}

function selectTaskType(
  scores: Readonly<Record<UnderstoodTaskType, number>>,
): UnderstoodTaskType {
  let selected: UnderstoodTaskType = "qa";
  let selectedScore = scores.qa;

  for (const taskType of TASK_TIE_BREAK_PRIORITY) {
    const score = scores[taskType];

    if (score > selectedScore || (score === selectedScore && score > 0)) {
      selected = taskType;
      selectedScore = score;
    }
  }

  return selected;
}

function calculateConfidence(
  selectedTaskType: UnderstoodTaskType,
  scores: Readonly<Record<UnderstoodTaskType, number>>,
): { confidence: number; margin: number } {
  const orderedScores = Object.entries(scores)
    .filter(([taskType]) => taskType !== selectedTaskType)
    .map(([, score]) => score)
    .sort((left, right) => right - left);
  const selectedScore = scores[selectedTaskType];
  const runnerUpScore = orderedScores[0] ?? 0;

  if (selectedScore === 0) {
    return { confidence: 0.55, margin: 0 };
  }

  const strength = Math.min(1, selectedScore / 5);
  const margin = Math.max(0, (selectedScore - runnerUpScore) / selectedScore);
  const confidence = clamp(0.55 + 0.25 * strength + 0.18 * margin, 0.55, 0.98);

  return {
    confidence: round(confidence),
    margin: round(margin),
  };
}

function toDetails(input: {
  mode: "explicit" | "rules" | "fallback";
  scores: Readonly<Record<UnderstoodTaskType, number>>;
  decisionMargin: number;
  signalIds: readonly string[];
}): JsonObject {
  return {
    classifier: CLASSIFIER_NAME,
    classifier_version: CLASSIFIER_VERSION,
    mode: input.mode,
    intent_scores: { ...input.scores },
    decision_margin: input.decisionMargin,
    signal_ids: [...input.signalIds],
  };
}

/** Lightweight, deterministic first version of Novera's Task Understanding Layer. */
export class QueryUnderstandingLayer {
  understand(input: UnderstandQueryInput): QueryUnderstandingResult {
    const normalizedQuery = normalizeUserQuery(input.query);

    if (!normalizedQuery) {
      throw new QueryUnderstandingError(
        "EMPTY_QUERY",
        "A non-empty user query is required for task understanding.",
      );
    }

    const requestedTaskType = input.requestedTaskType ?? "auto";

    if (requestedTaskType !== "auto") {
      const scores = emptyIntentScores();
      scores[requestedTaskType] = 1;
      const signals: QueryUnderstandingSignal[] = [
        {
          id: "requested-task-type",
          taskType: requestedTaskType,
          matchedText: requestedTaskType,
          weight: 1,
        },
      ];

      return {
        requestedTaskType,
        understoodTaskType: requestedTaskType,
        confidence: 1,
        normalizedQuery,
        signals,
        details: toDetails({
          mode: "explicit",
          scores,
          decisionMargin: 1,
          signalIds: signals.map((signal) => signal.id),
        }),
      };
    }

    const classificationText = normalizedQuery.toLocaleLowerCase("en-US");
    const scores = emptyIntentScores();
    const signals: QueryUnderstandingSignal[] = [];

    for (const rule of INTENT_RULES) {
      const match = classificationText.match(rule.pattern);

      if (!match?.[0]) {
        continue;
      }

      scores[rule.taskType] = round(scores[rule.taskType] + rule.weight);
      signals.push({
        id: rule.id,
        taskType: rule.taskType,
        matchedText: match[0],
        weight: rule.weight,
      });
    }

    const understoodTaskType = selectTaskType(scores);
    const { confidence, margin } = calculateConfidence(understoodTaskType, scores);
    const mode = signals.length > 0 ? "rules" : "fallback";

    return {
      requestedTaskType,
      understoodTaskType,
      confidence,
      normalizedQuery,
      signals,
      details: toDetails({
        mode,
        scores,
        decisionMargin: margin,
        signalIds: signals.map((signal) => signal.id),
      }),
    };
  }
}

export function understandQuery(input: UnderstandQueryInput): QueryUnderstandingResult {
  return new QueryUnderstandingLayer().understand(input);
}
