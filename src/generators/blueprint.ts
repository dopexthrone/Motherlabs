/**
 * Blueprint Spec Generator (G3)
 * =============================
 *
 * Generates Blueprint specifications (X artifacts) from clarified intents.
 * The Blueprint is the architectural design that precedes implementation.
 *
 * From Kernel Spec C35:PT-G3:
 * - Input: ClarifiedIntent, CodebaseContext
 * - Output: BlueprintSpec (X artifact)
 */

import { BaseGenerator, parseJSON, buildStructuredPrompt } from './base.js';
import type {
  GeneratorContext,
  BlueprintInput,
  BlueprintOutput,
  BlueprintSpec,
  BlueprintComponent,
} from './types.js';

// =============================================================================
// Blueprint Generator
// =============================================================================

/**
 * G3: Blueprint Spec Generator
 *
 * Generates architectural blueprints from clarified intents.
 */
export class BlueprintGenerator extends BaseGenerator<
  BlueprintInput,
  BlueprintOutput
> {
  readonly id = 'G3' as const;
  readonly name = 'BlueprintSpecGenerator';
  readonly description =
    'Generates Blueprint specifications (X artifacts) from clarified intents';

  protected getSystemPrompt(): string {
    return `You are an AI software architect that creates detailed implementation blueprints.

Your role is to:
1. Analyze the clarified intent and understand what needs to be built
2. Break down the work into discrete components
3. Identify dependencies between components
4. Define clear acceptance criteria
5. Assess complexity and identify risks

Blueprint Components can be:
- file: A source code file
- function: A function within a file
- class: A class or module
- module: A package or directory
- config: Configuration file
- test: Test file or suite
- doc: Documentation

Actions for components:
- create: New component
- modify: Change existing component
- delete: Remove component

Complexity levels:
- trivial: Single-line change
- simple: Few lines, single file
- moderate: Multiple files, clear scope
- complex: Multiple components, some risk
- very_complex: Major changes, high risk

Output Format:
You MUST respond with valid JSON in this exact structure:
{
  "confidence": number (0-1),
  "warnings": ["string"] or null,
  "blueprint": {
    "version": "1.0",
    "title": "short descriptive title",
    "description": "what this blueprint accomplishes",
    "components": [
      {
        "id": "unique_id",
        "name": "component name",
        "purpose": "what it does",
        "type": "file|function|class|module|config|test|doc",
        "path": "relative/path/to/file" or null,
        "action": "create|modify|delete",
        "details": "specific changes to make"
      }
    ],
    "dependencies": [["component_id_1", "depends_on_id"], ...],
    "acceptance_criteria": ["criterion 1", "criterion 2", ...],
    "complexity": "trivial|simple|moderate|complex|very_complex",
    "risks": ["risk 1", "risk 2", ...]
  }
}`;
  }

  protected buildPrompt(
    input: BlueprintInput,
    context: GeneratorContext
  ): string {
    const sections = [
      {
        title: 'Intent Goal',
        content: input.goal,
      },
      {
        title: 'Constraints',
        content: input.constraints.length
          ? input.constraints.map((c) => `- ${c}`).join('\n')
          : 'None specified',
      },
      {
        title: 'Context',
        content: JSON.stringify(input.context, null, 2),
      },
      {
        title: 'Codebase Summary',
        content: input.codebase_summary || 'Not provided - assume new project',
      },
      {
        title: 'Clarifications',
        content: input.clarifications
          ? Object.entries(input.clarifications)
              .map(([q, a]) => `Q: ${q}\nA: ${a}`)
              .join('\n\n')
          : 'None (intent was clear)',
      },
      {
        title: 'Working Directory',
        content: context.working_dir,
      },
      {
        title: 'Task',
        content: `Create a detailed blueprint for implementing this intent.
Break down the work into discrete components with clear actions.
Identify all dependencies and acceptance criteria.
Assess complexity and risks honestly.

Respond with JSON only.`,
      },
    ];

    return buildStructuredPrompt(sections);
  }

  protected parseResponse(response: string): BlueprintOutput {
    const parsed = parseJSON<RawBlueprintResponse>(response);

    // Validate blueprint
    const blueprint: BlueprintSpec = {
      version: '1.0',
      title: String(parsed.blueprint?.title || 'Untitled Blueprint'),
      description: String(parsed.blueprint?.description || ''),
      components: (parsed.blueprint?.components || []).map(
        (c, i) =>
          ({
            id: String(c.id || `component_${i}`),
            name: String(c.name || ''),
            purpose: String(c.purpose || ''),
            type: validateComponentType(c.type),
            path: c.path ? String(c.path) : undefined,
            action: validateAction(c.action),
            details: String(c.details || ''),
          }) as BlueprintComponent
      ),
      dependencies: (parsed.blueprint?.dependencies || []).map((d) =>
        Array.isArray(d) ? d.map(String) : []
      ),
      acceptance_criteria: (parsed.blueprint?.acceptance_criteria || []).map(
        String
      ),
      complexity: validateComplexity(parsed.blueprint?.complexity),
      risks: (parsed.blueprint?.risks || []).map(String),
    };

    const output: BlueprintOutput = {
      blueprint,
      confidence:
        typeof parsed.confidence === 'number'
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.5,
    };
    if (Array.isArray(parsed.warnings) && parsed.warnings.length > 0) {
      output.warnings = parsed.warnings.map(String);
    }
    return output;
  }

  protected getDefaultOutput(): BlueprintOutput {
    return {
      blueprint: {
        version: '1.0',
        title: 'Failed to Generate Blueprint',
        description: 'The LLM response could not be parsed',
        components: [],
        dependencies: [],
        acceptance_criteria: [],
        complexity: 'moderate',
        risks: ['Blueprint generation failed - manual review required'],
      },
      confidence: 0,
      warnings: ['Failed to parse LLM response'],
    };
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Raw response from LLM before validation.
 */
interface RawBlueprintResponse {
  confidence?: number;
  warnings?: string[];
  blueprint?: {
    version?: string;
    title?: string;
    description?: string;
    components?: Array<{
      id?: string;
      name?: string;
      purpose?: string;
      type?: string;
      path?: string;
      action?: string;
      details?: string;
    }>;
    dependencies?: string[][];
    acceptance_criteria?: string[];
    complexity?: string;
    risks?: string[];
  };
}

/**
 * Validate component type.
 */
function validateComponentType(
  type: string | undefined
): BlueprintComponent['type'] {
  const valid = ['file', 'function', 'class', 'module', 'config', 'test', 'doc'];
  if (type && valid.includes(type)) {
    return type as BlueprintComponent['type'];
  }
  return 'file';
}

/**
 * Validate action.
 */
function validateAction(
  action: string | undefined
): BlueprintComponent['action'] {
  const valid = ['create', 'modify', 'delete'];
  if (action && valid.includes(action)) {
    return action as BlueprintComponent['action'];
  }
  return 'create';
}

/**
 * Validate complexity.
 */
function validateComplexity(
  complexity: string | undefined
): BlueprintSpec['complexity'] {
  const valid = ['trivial', 'simple', 'moderate', 'complex', 'very_complex'];
  if (complexity && valid.includes(complexity)) {
    return complexity as BlueprintSpec['complexity'];
  }
  return 'moderate';
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new blueprint generator.
 */
export function createBlueprintGenerator(): BlueprintGenerator {
  return new BlueprintGenerator();
}
