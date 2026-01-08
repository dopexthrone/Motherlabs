/**
 * Clarifier Generator (G0)
 * ========================
 *
 * Analyzes intents for ambiguity and generates clarifying questions.
 * This is the first generator in the pipeline - it ensures the intent
 * is clear before proceeding to blueprint generation.
 *
 * From Kernel Spec C35:PT-G0:
 * - Input: IntentRecordCandidate, AmbiguityReport
 * - Output: ClarificationRequest
 */

import { BaseGenerator, parseJSON, buildStructuredPrompt } from './base.js';
import type {
  GeneratorContext,
  ClarifierInput,
  ClarifierOutput,
  ClarificationQuestion,
} from './types.js';

// =============================================================================
// Clarifier Generator
// =============================================================================

/**
 * G0: Clarifier Generator
 *
 * Analyzes the intent and generates clarifying questions if needed.
 */
export class ClarifierGenerator extends BaseGenerator<
  ClarifierInput,
  ClarifierOutput
> {
  readonly id = 'G0' as const;
  readonly name = 'ClarifierGenerator';
  readonly description =
    'Analyzes intents for ambiguity and generates clarifying questions';

  protected getSystemPrompt(): string {
    return `You are an AI assistant that helps clarify software development requirements.

Your role is to:
1. Analyze the given intent/goal for ambiguity
2. Identify missing information that would be needed to implement the request
3. Generate clear, specific questions to resolve ambiguities
4. Prioritize questions by importance

Rules:
- Be concise and specific in your questions
- Focus on information that affects implementation
- Don't ask about obvious details
- Categorize questions appropriately
- If the intent is clear enough, indicate no clarification is needed

Output Format:
You MUST respond with valid JSON in this exact structure:
{
  "needs_clarification": boolean,
  "reason": "string explaining why clarification is or isn't needed",
  "questions": [
    {
      "question": "the question text",
      "category": "scope|requirements|constraints|preferences|technical",
      "options": ["option1", "option2"] or null,
      "required": boolean,
      "priority": number (1 = highest)
    }
  ]
}`;
  }

  protected buildPrompt(
    input: ClarifierInput,
    context: GeneratorContext
  ): string {
    const sections = [
      {
        title: 'Intent Goal',
        content: input.goal,
      },
      {
        title: 'Constraints',
        content: input.constraints?.length
          ? input.constraints.map((c) => `- ${c}`).join('\n')
          : 'None specified',
      },
      {
        title: 'Context',
        content: input.context
          ? JSON.stringify(input.context, null, 2)
          : 'None provided',
      },
      {
        title: 'Ambiguity Report',
        content: input.ambiguity_report
          ? `Ambiguous terms: ${input.ambiguity_report.ambiguous_terms.join(', ')}\n` +
            `Missing info: ${input.ambiguity_report.missing_info.join(', ')}\n` +
            `Confidence: ${input.ambiguity_report.confidence}`
          : 'None (fresh analysis requested)',
      },
      {
        title: 'Task',
        content: `Analyze this intent and determine if clarification is needed.
If clarification is needed, generate specific questions.
If the intent is clear enough to proceed, indicate that.

Respond with JSON only.`,
      },
    ];

    return buildStructuredPrompt(sections);
  }

  protected parseResponse(response: string): ClarifierOutput {
    const parsed = parseJSON<RawClarifierResponse>(response);

    // Validate and normalize
    const questions: ClarificationQuestion[] = (parsed.questions || []).map(
      (q, i) => {
        const question: ClarificationQuestion = {
          question: String(q.question || ''),
          category: validateCategory(q.category),
          required: Boolean(q.required),
          priority: typeof q.priority === 'number' ? q.priority : i + 1,
        };
        if (Array.isArray(q.options) && q.options.length > 0) {
          question.options = q.options.map(String);
        }
        return question;
      }
    );

    return {
      needs_clarification: Boolean(parsed.needs_clarification),
      reason: String(parsed.reason || ''),
      questions,
    };
  }

  protected getDefaultOutput(): ClarifierOutput {
    return {
      needs_clarification: true,
      reason: 'Unable to parse LLM response',
      questions: [
        {
          question: 'Could you please clarify your request?',
          category: 'requirements',
          required: true,
          priority: 1,
        },
      ],
    };
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Raw response from LLM before validation.
 */
interface RawClarifierResponse {
  needs_clarification?: boolean;
  reason?: string;
  questions?: Array<{
    question?: string;
    category?: string;
    options?: string[];
    required?: boolean;
    priority?: number;
  }>;
}

/**
 * Validate and normalize category.
 */
function validateCategory(
  category: string | undefined
): ClarificationQuestion['category'] {
  const valid = ['scope', 'requirements', 'constraints', 'preferences', 'technical'];
  if (category && valid.includes(category)) {
    return category as ClarificationQuestion['category'];
  }
  return 'requirements';
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new clarifier generator.
 */
export function createClarifierGenerator(): ClarifierGenerator {
  return new ClarifierGenerator();
}
