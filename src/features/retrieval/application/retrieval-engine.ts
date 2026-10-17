import type { TaskType } from "@/domain";
import {
  ContextBuilder,
  ContextBuilderError,
  type BuiltPromptContext,
} from "@/features/retrieval/application/context-builder";
import {
  QueryUnderstandingError,
  QueryUnderstandingLayer,
  type QueryUnderstandingResult,
} from "@/features/retrieval/application/query-understanding";
import { RetrievalError } from "@/features/retrieval/application/retrieval-error";
import {
  RetrieverService,
  type RetrieveKnowledgeResult,
} from "@/features/retrieval/application/retriever-service";

export interface ExecuteRetrievalInput {
  query: string;
  knowledgeBaseId: string;
  requestedTaskType?: TaskType;
  topK?: number;
  similarityThreshold?: number;
  documentIds?: readonly string[];
}

export interface RetrievalEngineResult {
  query: string;
  taskUnderstanding: QueryUnderstandingResult;
  retrieval: RetrieveKnowledgeResult;
  context: BuiltPromptContext;
}

/**
 * Phase 3 orchestration boundary:
 * Query Understanding -> query embedding -> pgvector retrieval -> bounded context.
 */
export class RetrievalEngine {
  constructor(
    private readonly retriever: RetrieverService,
    private readonly queryUnderstanding: QueryUnderstandingLayer =
      new QueryUnderstandingLayer(),
    private readonly contextBuilder: ContextBuilder = new ContextBuilder(),
  ) {}

  async execute(input: ExecuteRetrievalInput): Promise<RetrievalEngineResult> {
    let taskUnderstanding: QueryUnderstandingResult;

    try {
      taskUnderstanding = this.queryUnderstanding.understand({
        query: input.query,
        requestedTaskType: input.requestedTaskType,
      });
    } catch (error) {
      if (error instanceof QueryUnderstandingError) {
        throw new RetrievalError(
          error.message,
          "INVALID_REQUEST",
          400,
          { query_understanding_code: error.code },
          { cause: error },
        );
      }

      throw error;
    }

    const retrieval = await this.retriever.retrieve({
      query: taskUnderstanding.normalizedQuery,
      knowledgeBaseId: input.knowledgeBaseId,
      topK: input.topK,
      similarityThreshold: input.similarityThreshold,
      documentIds: input.documentIds,
    });

    let context: BuiltPromptContext;

    try {
      context = this.contextBuilder.build(retrieval.chunks, {
        minimumSimilarity: retrieval.similarityThreshold,
      });
    } catch (error) {
      if (error instanceof ContextBuilderError) {
        throw new RetrievalError(
          "The retrieved knowledge could not be converted into bounded prompt context.",
          "VECTOR_RETRIEVAL_FAILED",
          500,
          { context_builder_code: error.code },
          { cause: error },
        );
      }

      throw error;
    }

    return {
      query: retrieval.query,
      taskUnderstanding,
      retrieval,
      context,
    };
  }
}
