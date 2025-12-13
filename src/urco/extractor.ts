// URCO v0.2 - Entity/Action Extraction (Deterministic, no mocks)

import { Entity, Action } from './types'

/**
 * Extract entities from text using deterministic regex patterns.
 * Pass 1: Explicit markers (highest precision)
 * Pass 2: Noun phrase heuristics (only if Pass 1 yields < 2 entities)
 */
export function extractEntities(text: string): Entity[] {
  const entities: Entity[] = []

  // A. Bracket tags: [Tag]
  const bracketRegex = /\[([A-Za-z0-9_\-]+)\]/g
  for (const match of text.matchAll(bracketRegex)) {
    entities.push({
      raw: match[1],
      kind: 'tag',
      span: [match.index!, match.index! + match[0].length]
    })
  }

  // B. Quoted names: "name" or 'name'
  const quoteRegex = /["']([^"']{2,80})["']/g
  for (const match of text.matchAll(quoteRegex)) {
    entities.push({
      raw: match[1],
      kind: 'quote',
      span: [match.index!, match.index! + match[0].length]
    })
  }

  // C. Code identifiers (CamelCase, snake_case, or type suffixes)
  const identifierRegex = /\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g
  for (const match of text.matchAll(identifierRegex)) {
    const word = match[0]
    const hasUnderscore = word.includes('_')
    const hasCamelCase = /[a-z][A-Z]/.test(word)
    const hasTypeSuffix = /(Service|Engine|Agent|Kernel|Spec|Schema|Plan|Contract|Policy|Ledger|Manifest|Validator|Extractor|Orchestrator|Router)$/.test(word)

    if (hasUnderscore || hasCamelCase || hasTypeSuffix) {
      entities.push({
        raw: word,
        kind: 'identifier',
        span: [match.index!, match.index! + match[0].length]
      })
    }
  }

  // D. File paths: ./path or /path
  const pathRegex = /(?:\.\/|\/)[^\s]+/g
  for (const match of text.matchAll(pathRegex)) {
    entities.push({
      raw: match[0],
      kind: 'path',
      span: [match.index!, match.index! + match[0].length]
    })
  }

  // E. URLs
  const urlRegex = /https?:\/\/[^\s]+/g
  for (const match of text.matchAll(urlRegex)) {
    entities.push({
      raw: match[0],
      kind: 'url',
      span: [match.index!, match.index! + match[0].length]
    })
  }

  // Pass 2: Noun phrases (only if < 2 entities from Pass 1)
  if (entities.length < 2) {
    const domainNouns = /\b(engine|kernel|agent|schema|contract|ledger|evidence|policy|validator|extractor|planner|runner|harness|tests|pipeline|repo|cli|daemon)\b/gi
    for (const match of text.matchAll(domainNouns)) {
      entities.push({
        raw: match[0],
        kind: 'phrase',
        span: [match.index!, match.index! + match[0].length]
      })
    }
  }

  // Return frozen array to prevent external mutation
  return Object.freeze(entities) as Entity[]
}

/**
 * Extract actions from text using deterministic patterns.
 */
export function extractActions(text: string): Action[] {
  const actions: Action[] = []

  // A. Imperatives at line start
  const imperativeRegex = /^\s*(build|implement|add|remove|create|define|validate|detect|extract|parse|generate|synthesize|examine|expand|score|rank|prune|test|refactor|document|log|audit|optimize|improve|deploy|install|run|execute)\b/gmi
  for (const match of text.matchAll(imperativeRegex)) {
    actions.push({
      verb: match[1].toLowerCase(),
      source: 'imperative',
      span: [match.index!, match.index! + match[0].length]
    })
  }

  // B. Verb + object patterns
  const verbObjectRegex = /\b(implement|build|add|remove|create|define|validate|detect|extract|generate|synthesize|score|rank|optimize|improve|deploy|install|run|execute|test|benchmark)\s+([a-z0-9_\- ]{2,60})/gi
  for (const match of text.matchAll(verbObjectRegex)) {
    const obj = match[2].trim()
      .replace(/^(the|a|an|of|for|to|in|with|on)\s+/i, '')
      .replace(/\s+(the|a|an|of|for|to|in|with|on)$/i, '')
      .trim()

    if (obj.length > 0) {
      actions.push({
        verb: match[1].toLowerCase(),
        object: obj,
        source: 'verb_object',
        span: [match.index!, match.index! + match[0].length]
      })
    }
  }

  // Return frozen array to prevent external mutation
  return Object.freeze(actions) as Action[]
}

/**
 * Normalize text for comparison (deterministic)
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Compute token overlap between two strings (Jaccard similarity)
 */
export function tokenOverlap(a: string, b: string): number {
  const tokensA = new Set(normalize(a).split(' '))
  const tokensB = new Set(normalize(b).split(' '))

  const intersection = new Set([...tokensA].filter(t => tokensB.has(t)))
  const union = new Set([...tokensA, ...tokensB])

  if (union.size === 0) return 0
  return intersection.size / union.size
}
