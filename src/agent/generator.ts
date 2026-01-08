/**
 * Code Generator
 * ==============
 *
 * LLM-based code generation with context retrieval (RAG).
 */

import { randomBytes } from 'node:crypto';
import type { ModelAdapter, TransformContext } from '../adapters/model.js';
import type {
  GenerationRequest,
  GenerationResult,
  ContextItem,
  VerificationResult,
  AgentConfig,
} from './types.js';
import { buildAugmentedPrompt, detectPatterns, type AugmentedPrompt } from '../prompt/index.js';

// =============================================================================
// Generator
// =============================================================================

/**
 * Code generator using LLM with optional RAG.
 */
export class CodeGenerator {
  private readonly adapter: ModelAdapter;
  private readonly config: AgentConfig;

  constructor(adapter: ModelAdapter, config: AgentConfig) {
    this.adapter = adapter;
    this.config = config;
  }

  /**
   * Generate code from a request.
   */
  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const startTime = performance.now();
    let attempts = 0;
    let lastError: string | undefined;
    let bestResult: { code: string; confidence: number } | null = null;

    while (attempts < this.config.max_attempts) {
      attempts++;

      try {
        const prompt = this.buildPrompt(request, attempts);
        const context: TransformContext = {
          intent_id: request.id,
          run_id: `gen_${randomBytes(4).toString('hex')}`,
          mode: 'execute',
          constraints: request.constraints ?? [],
          metadata: { language: request.language },
        };
        const result = await this.adapter.transform(prompt, context);

        const code = this.extractCode(result.content, request.language);
        const confidence = this.estimateConfidence(code, request);

        if (!bestResult || confidence > bestResult.confidence) {
          bestResult = { code, confidence };
        }

        // If confidence is high enough, return
        if (confidence >= this.config.confidence_threshold) {
          return this.buildResult(request, bestResult, attempts, startTime, {
            model: this.adapter.model_id,
            tokens_used: result.tokens_input + result.tokens_output,
          });
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    // Return best result even if below threshold
    if (bestResult) {
      return this.buildResult(request, bestResult, attempts, startTime, {
        model: this.adapter.model_id,
        tokens_used: 0,
      });
    }

    // Complete failure
    const failResult: GenerationResult = {
      request_id: request.id,
      success: false,
      confidence: 0,
      verification: this.emptyVerification(),
      attempts,
      needs_review: true,
      metadata: {
        model: this.adapter.model_id,
        tokens_used: 0,
        latency_ms: Math.round(performance.now() - startTime),
        context_items: request.context?.length ?? 0,
      },
    };
    failResult.review_reason = 'Generation failed after max attempts';
    if (lastError) {
      failResult.error = lastError;
    }
    return failResult;
  }

  /**
   * Build the generation prompt with optional few-shot augmentation.
   */
  private buildPrompt(request: GenerationRequest, attempt: number): string {
    const sections: string[] = [];

    // If we have context, use augmented prompt building for better few-shot examples
    if (request.context && request.context.length > 0) {
      const augmented = buildAugmentedPrompt(request.prompt, request.language, request.context, {
        maxExamples: 3,
        maxContextTokens: this.config.max_context_tokens,
        includePatterns: true,
        includeStyleHints: true,
        minRelevance: 0.4,
      });

      // Use the augmented system and examples
      sections.push(augmented.system);
      if (augmented.examples) sections.push(augmented.examples);
      if (augmented.patterns) sections.push(augmented.patterns);
    } else {
      // Fallback to basic system instruction
      sections.push(`You are an expert ${request.language} programmer. Generate clean, correct, production-ready code.`);
    }

    // Constraints
    if (request.constraints && request.constraints.length > 0) {
      sections.push('\n## Constraints\n');
      for (const c of request.constraints) {
        sections.push(`- ${c}`);
      }
    }

    // Signature
    if (request.signature) {
      sections.push(`\n## Required Signature\n\`\`\`${request.language}\n${request.signature}\n\`\`\`\n`);
    }

    // Test cases
    if (request.test_cases && request.test_cases.length > 0) {
      sections.push('\n## Test Cases to Satisfy\n');
      for (const tc of request.test_cases) {
        sections.push(`- ${tc.name}: ${JSON.stringify(tc.inputs)} → ${JSON.stringify(tc.expected)}`);
      }
    }

    // Main task
    sections.push(`\n## Task\n${request.prompt}\n`);

    // Attempt hint
    if (attempt > 1) {
      sections.push(`\n(Attempt ${attempt}/${this.config.max_attempts} - be more careful with edge cases)\n`);
    }

    // Output format
    sections.push(`\n## Output\nRespond with ONLY the ${request.language} code, wrapped in \`\`\`${request.language} code blocks. No explanations.`);

    return sections.join('\n');
  }

  /**
   * Extract code from LLM response.
   */
  private extractCode(response: string, language: string): string {
    // Try to find code block
    const codeBlockRegex = new RegExp(`\`\`\`(?:${language})?\\s*\\n([\\s\\S]*?)\`\`\``, 'i');
    const match = response.match(codeBlockRegex);

    if (match && match[1]) {
      return match[1].trim();
    }

    // Try generic code block
    const genericMatch = response.match(/```\s*\n([\s\S]*?)```/);
    if (genericMatch && genericMatch[1]) {
      return genericMatch[1].trim();
    }

    // Return raw response (might be just code)
    return response.trim();
  }

  /**
   * Estimate confidence in generated code.
   */
  private estimateConfidence(code: string, request: GenerationRequest): number {
    let score = 0.5; // Base score

    // Has code
    if (code.length > 10) score += 0.1;

    // Has function/class definition
    if (/(?:def|function|class|const|let|var)\s+\w+/.test(code)) score += 0.1;

    // Matches expected signature
    if (request.signature) {
      const sigParts = request.signature.split('(');
      if (sigParts[0] && code.includes(sigParts[0])) {
        score += 0.1;
      }
    }

    // Has docstring/comments
    if (/(?:"""|\*\*|\/\/|#)/.test(code)) score += 0.05;

    // Reasonable length
    if (code.length > 50 && code.length < 5000) score += 0.05;

    // No obvious errors
    if (!/(?:TODO|FIXME|XXX|undefined|null\s*\)|NaN)/.test(code)) score += 0.1;

    return Math.min(1, score);
  }

  /**
   * Build generation result.
   */
  private buildResult(
    request: GenerationRequest,
    result: { code: string; confidence: number },
    attempts: number,
    startTime: number,
    meta: { model: string; tokens_used: number }
  ): GenerationResult {
    const needsReview = result.confidence < this.config.confidence_threshold;

    const genResult: GenerationResult = {
      request_id: request.id,
      success: true,
      code: result.code,
      confidence: result.confidence,
      verification: this.emptyVerification(), // Will be filled by verifier
      attempts,
      needs_review: needsReview,
      metadata: {
        model: meta.model,
        tokens_used: meta.tokens_used,
        latency_ms: Math.round(performance.now() - startTime),
        context_items: request.context?.length ?? 0,
      },
    };
    if (needsReview) {
      genResult.review_reason = 'low_confidence';
    }
    return genResult;
  }

  /**
   * Empty verification result placeholder.
   */
  private emptyVerification(): VerificationResult {
    return {
      passed: false,
      score: 0,
      checks: [],
      issues: [],
      suggestions: [],
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a code generator.
 */
export function createCodeGenerator(
  adapter: ModelAdapter,
  config: Partial<AgentConfig> = {}
): CodeGenerator {
  const fullConfig: AgentConfig = {
    mode: config.mode ?? 'auto',
    verification_level: config.verification_level ?? 'standard',
    max_attempts: config.max_attempts ?? 3,
    confidence_threshold: config.confidence_threshold ?? 0.85,
    languages: config.languages ?? ['python', 'typescript', 'javascript'],
    enable_rag: config.enable_rag ?? true,
    auto_eval: config.auto_eval ?? false,
    auto_repair: config.auto_repair ?? true,
    auto_style: config.auto_style ?? true,
    auto_security: config.auto_security ?? true,
    security_threshold: config.security_threshold ?? 'high',
    auto_docs: config.auto_docs ?? false,
    max_context_tokens: config.max_context_tokens ?? 8192,
  };

  return new CodeGenerator(adapter, fullConfig);
}

/**
 * Generate a unique request ID.
 */
export function generateRequestId(): string {
  return `req_${randomBytes(8).toString('hex')}`;
}
