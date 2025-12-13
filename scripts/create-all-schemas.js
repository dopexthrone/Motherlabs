#!/usr/bin/env node
// Create schemas for all remaining types

const fs = require('fs')

const schemas = {
  'candidatetype': { type: 'string', enum: ['AND_SPLIT', 'OR_SPLIT', 'SEQ_SPLIT', 'CLARIFICATION', 'HYPOTHESIS', 'RETRIEVAL'] },
  'evidenceplan': { type: 'object', required: ['method', 'procedure', 'artifacts', 'acceptance'] },
  'entity': { type: 'object', required: ['raw', 'kind', 'span'] },
  'action': { type: 'object', required: ['verb', 'span', 'source'] },
  'missingvar': { type: 'object', required: ['key', 'hint', 'severity'] },
  'contradiction': { type: 'object', required: ['type', 'leftSpan', 'rightSpan', 'explanation', 'confidence'] },
  'scoredcandidate': { type: 'object', required: ['candidate', 'score', 'breakdown'] },
  'entropybreakdown': { type: 'object', required: ['unknowns', 'ambiguity', 'contradiction', 'specificityDeficit', 'dependencyUncertainty', 'verifiabilityDeficit'] },
  'nodeentropy': { type: 'object', required: ['value', 'breakdown'] },
  'synthesisresult': { type: 'object', required: ['representation', 'keptCount', 'removedCount', 'lossEstimate', 'mergeStrategy'] },
  'testtask': { type: 'object', required: ['id', 'name', 'description', 'input', 'category', 'difficulty', 'expectedArtifacts'] },
  'laneconfig': { type: 'object', required: ['id', 'name', 'model', 'useMotherlabs', 'description'] },
  'taskresult': { type: 'object', required: ['taskId', 'laneId', 'timestamp', 'rawOutput', 'outputTokens', 'metrics', 'evidence'] },
  'benchmarkreport': { type: 'object', required: ['timestamp', 'lanes', 'tasks', 'results', 'summary', 'winner'] },
  'traptype': { type: 'string', enum: ['contradiction', 'deprecated_lib', 'security_violation', 'missing_critical_var', 'unpinned_deps', 'no_evidence', 'unsafe_operation'] },
  'traptask': { type: 'object', required: ['id', 'name', 'description', 'input', 'category', 'difficulty', 'expectedArtifacts', 'trapType', 'expectedBehavior', 'trapDescription'] }
}

for (const [name, def] of Object.entries(schemas)) {
  const schema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": `motherlabs://schemas/${name}.schema.json`,
    "title": `${name.charAt(0).toUpperCase() + name.slice(1)} Schema`,
    ...def,
    "additionalProperties": false
  }

  fs.writeFileSync(`schemas/${name}.schema.json`, JSON.stringify(schema, null, 2))
}

console.log(`✓ Created ${Object.keys(schemas).length} schemas`)
