/**
 * Seeded PRNG for property-based testing.
 * Uses mulberry32 algorithm - simple, fast, deterministic.
 *
 * IMPORTANT: This is for TEST generation only.
 * Never use in kernel bundle/hash paths.
 */

export interface SeededRng {
  /** Returns float in [0, 1) */
  next(): number;
  /** Returns integer in [min, max] inclusive */
  nextInt(min: number, max: number): number;
  /** Returns random element from array */
  pick<T>(arr: readonly T[]): T;
  /** Shuffles array in place deterministically */
  shuffle<T>(arr: T[]): T[];
  /** Returns random string of given length */
  nextString(length: number, charset?: string): string;
  /** Returns random boolean with given probability of true */
  nextBool(pTrue?: number): boolean;
}

/**
 * Creates a seeded random number generator.
 * Same seed always produces same sequence.
 */
export function createRng(seed: number): SeededRng {
  // Mulberry32 algorithm
  let state = seed >>> 0;

  function next(): number {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function nextInt(min: number, max: number): number {
    return Math.floor(next() * (max - min + 1)) + min;
  }

  function pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new Error('Cannot pick from empty array');
    }
    return arr[nextInt(0, arr.length - 1)] as T;
  }

  function shuffle<T>(arr: T[]): T[] {
    // Fisher-Yates shuffle
    for (let i = arr.length - 1; i > 0; i--) {
      const j = nextInt(0, i);
      const temp = arr[i] as T;
      arr[i] = arr[j] as T;
      arr[j] = temp;
    }
    return arr;
  }

  function nextString(length: number, charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'): string {
    let result = '';
    for (let i = 0; i < length; i++) {
      result += charset[nextInt(0, charset.length - 1)];
    }
    return result;
  }

  function nextBool(pTrue = 0.5): boolean {
    return next() < pTrue;
  }

  return { next, nextInt, pick, shuffle, nextString, nextBool };
}

/**
 * Generated intent structure (all fields present for testing)
 */
export interface GeneratedIntent {
  goal: string;
  constraints: string[] | null;
  context: Record<string, unknown> | null;
}

/**
 * Generates test data deterministically from seed.
 */
export interface TestDataGenerator {
  /** Generate a random intent for property testing */
  generateIntent(): GeneratedIntent;
  /** Generate adversarial unicode string */
  generateUnicodeEdgeCase(): string;
  /** Generate contradictory constraints */
  generateContradiction(): [string, string];
}

export function createTestDataGenerator(seed: number): TestDataGenerator {
  const rng = createRng(seed);

  const goalPrefixes = [
    'Build', 'Create', 'Implement', 'Design', 'Generate',
    'Develop', 'Construct', 'Produce', 'Make', 'Write'
  ];

  const goalObjects = [
    'a web application', 'an API server', 'a CLI tool',
    'a database schema', 'a test suite', 'a documentation site',
    'a mobile app', 'a REST endpoint', 'a GraphQL resolver',
    'a validation layer', 'an authentication system', 'a cache layer'
  ];

  const constraintTemplates = [
    'Must use {tech}',
    'Should be {quality}',
    'Requires {feature}',
    'Must handle {scenario}',
    'Should support {capability}'
  ];

  const techs = ['TypeScript', 'Python', 'Rust', 'Go', 'Node.js', 'React', 'Vue'];
  const qualities = ['performant', 'secure', 'maintainable', 'testable', 'scalable'];
  const features = ['authentication', 'logging', 'caching', 'rate limiting', 'monitoring'];
  const scenarios = ['errors gracefully', 'high load', 'concurrent access', 'network failures'];
  const capabilities = ['multiple formats', 'internationalization', 'accessibility', 'offline mode'];

  function generateIntent(): GeneratedIntent {
    const goal = `${rng.pick(goalPrefixes)} ${rng.pick(goalObjects)}`;

    const constraintCount = rng.nextInt(0, 5);
    const constraints: string[] = [];

    for (let i = 0; i < constraintCount; i++) {
      let template = rng.pick(constraintTemplates);
      template = template.replace('{tech}', rng.pick(techs));
      template = template.replace('{quality}', rng.pick(qualities));
      template = template.replace('{feature}', rng.pick(features));
      template = template.replace('{scenario}', rng.pick(scenarios));
      template = template.replace('{capability}', rng.pick(capabilities));
      constraints.push(template);
    }

    const hasContext = rng.nextBool(0.3);
    const context = hasContext ? {
      environment: rng.pick(['production', 'development', 'staging']),
      priority: rng.pick(['high', 'medium', 'low'])
    } : null;

    return {
      goal,
      constraints: constraints.length > 0 ? constraints : null,
      context
    };
  }

  const unicodeEdgeCases = [
    '\u0000',                    // null char
    '\uFEFF',                    // BOM
    '\u200B',                    // zero-width space
    '\u200C',                    // zero-width non-joiner
    '\u200D',                    // zero-width joiner
    '\u2028',                    // line separator
    '\u2029',                    // paragraph separator
    '\uFFFD',                    // replacement char
    'café',                      // NFC
    'cafe\u0301',                // NFD (e + combining acute)
    '🎉',                        // emoji
    '👨‍👩‍👧‍👦',                       // family emoji (ZWJ sequence)
    '\u202E',                    // right-to-left override
    'A\u0308',                   // A + combining diaeresis (Ä in NFD)
    '\u00C4',                    // Ä in NFC
  ];

  function generateUnicodeEdgeCase(): string {
    const base = rng.pick(['goal', 'test', 'input', 'value']);
    const edgeChar = rng.pick(unicodeEdgeCases);
    const position = rng.pick(['prefix', 'suffix', 'middle']);

    switch (position) {
      case 'prefix': return edgeChar + base;
      case 'suffix': return base + edgeChar;
      case 'middle': return base.slice(0, 2) + edgeChar + base.slice(2);
      default: return base + edgeChar;
    }
  }

  const contradictionPairs: Array<[string, string]> = [
    ['Must be synchronous', 'Must be asynchronous'],
    ['Must be public', 'Must be private'],
    ['Must use SQL', 'Must not use any database'],
    ['Must run in browser', 'Must run only on server'],
    ['Must be stateless', 'Must maintain session state'],
    ['Must use REST', 'Must use GraphQL exclusively'],
    ['Must be single-threaded', 'Must use parallel processing'],
    ['Must have no dependencies', 'Must use React framework'],
    ['Must be offline-first', 'Must require constant connection'],
    ['Must be open source', 'Must be proprietary'],
  ];

  function generateContradiction(): [string, string] {
    return rng.pick(contradictionPairs);
  }

  return { generateIntent, generateUnicodeEdgeCase, generateContradiction };
}
