"use strict";
// URCO v0.2 - Missing Variable Detection (Real rules, no simulation)
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectMissingVars = detectMissingVars;
/**
 * Deterministic missing variable rules (25 patterns as specified)
 */
const MISSING_VAR_RULES = [
    // A. Optimize / improve / increase
    {
        trigger: { verbs: ['optimize', 'improve', 'increase', 'reduce', 'enhance'] },
        requires: [{
                key: 'metric',
                hint: 'What metric are you optimizing? (latency, throughput, cost, memory, etc.)',
                detectPresent: [/\b(metric|kpi|latency|throughput|accuracy|cost|memory|tokens|time|speed|size)\b/i]
            }],
        severity: 'error'
    },
    // B. Build / run / deploy / install
    {
        trigger: { verbs: ['build', 'run', 'deploy', 'install', 'execute'] },
        requires: [{
                key: 'env',
                hint: 'What environment? (prod, staging, dev, local, docker, etc.)',
                detectPresent: [/\b(env|environment|prod|staging|dev|local|docker|ubuntu|mac|windows|linux)\b/i]
            }],
        severity: 'warn'
    },
    // C. Evaluate / test / benchmark
    {
        trigger: { verbs: ['evaluate', 'test', 'benchmark'] },
        requires: [
            {
                key: 'dataset',
                hint: 'What dataset or test cases?',
                detectPresent: [/\b(dataset|corpus|examples|fixtures|test case|cases|unit tests|golden)\b/i]
            }
        ],
        severity: 'error'
    },
    // D. Detect contradiction
    {
        trigger: { contains: [/\bdetect\s+contradiction/i, /\bcontradiction\s+detection/i] },
        requires: [{
                key: 'scope',
                hint: 'Scope of contradiction detection? (within node, between nodes, etc.)',
                detectPresent: [/\b(scope|within|between|node|plan|spec)\b/i]
            }],
        severity: 'warn'
    },
    // E. Extract entities
    {
        trigger: { contains: [/\bextract\s+entit/i, /\bentity\s+extraction/i] },
        requires: [{
                key: 'source_text',
                hint: 'What text to extract from?',
                detectPresent: [/\b(text|input|prompt|document|node text|source)\b/i]
            }],
        severity: 'error'
    },
    // F. Validate evidence
    {
        trigger: { verbs: ['validate'], contains: [/\bevidence\b/i] },
        requires: [
            {
                key: 'method',
                hint: 'Validation method?',
                detectPresent: [/\b(method|procedure|check|test|verify)\b/i]
            },
            {
                key: 'artifacts',
                hint: 'What artifacts to validate?',
                detectPresent: [/\b(artifact|log|trace|record|file)\b/i]
            }
        ],
        severity: 'error'
    },
    // G. Rank / score / select
    {
        trigger: { verbs: ['rank', 'score', 'select', 'choose', 'prioritize'] },
        requires: [{
                key: 'criteria',
                hint: 'Ranking criteria or scoring rubric?',
                detectPresent: [/\b(criteria|rubric|rule|threshold|score|weight)\b/i]
            }],
        severity: 'error'
    },
    // H. Remove / prune / filter
    {
        trigger: { verbs: ['remove', 'prune', 'filter', 'discard'] },
        requires: [{
                key: 'removal_criteria',
                hint: 'What are the removal/pruning criteria?',
                detectPresent: [/\b(criteria|threshold|rule|remove if|prune if|filter if)\b/i]
            }],
        severity: 'error'
    },
    // I. Synthesize / merge / combine
    {
        trigger: { verbs: ['synthesize', 'summarize', 'compress', 'merge', 'combine'] },
        requires: [{
                key: 'target_format',
                hint: 'Target format for synthesis?',
                detectPresent: [/\b(format|json|schema|bullet|table|spec|yaml|markdown)\b/i]
            }],
        severity: 'warn'
    },
    // J. Parse / tokenize
    {
        trigger: { verbs: ['parse', 'tokenize'] },
        requires: [{
                key: 'grammar',
                hint: 'Grammar, tokenizer spec, or regex patterns?',
                detectPresent: [/\b(regex|grammar|tokenizer|ebnf|pattern|delimiter)\b/i]
            }],
        severity: 'error'
    },
    // K. Store / persist / save
    {
        trigger: { verbs: ['store', 'persist', 'save', 'write'] },
        requires: [
            {
                key: 'storage',
                hint: 'Where to store? (filesystem, database, ledger, etc.)',
                detectPresent: [/\b(file|disk|db|database|ledger|memory|cache)\b/i]
            }
        ],
        severity: 'warn'
    },
    // L. Load / read / fetch
    {
        trigger: { verbs: ['load', 'read', 'fetch', 'retrieve'] },
        requires: [{
                key: 'source',
                hint: 'Source to load from?',
                detectPresent: [/\b(file|path|url|api|database|kernel|ledger)\b/i]
            }],
        severity: 'warn'
    },
    // M. Compare / diff
    {
        trigger: { verbs: ['compare', 'diff'] },
        requires: [{
                key: 'comparison_basis',
                hint: 'What are you comparing? Need two inputs.',
                detectPresent: [/\b(before|after|old|new|baseline|current|vs|versus)\b/i]
            }],
        severity: 'error'
    },
    // N. Measure / calculate
    {
        trigger: { verbs: ['measure', 'calculate', 'compute'] },
        requires: [{
                key: 'formula',
                hint: 'What formula or measurement procedure?',
                detectPresent: [/\b(formula|equation|calculation|algorithm|procedure|method)\b/i]
            }],
        severity: 'error'
    },
    // O. Verify / check / assert
    {
        trigger: { verbs: ['verify', 'check', 'assert', 'ensure'] },
        requires: [{
                key: 'assertion',
                hint: 'What condition to verify?',
                detectPresent: [/\b(that|if|condition|constraint|invariant|requirement)\b/i]
            }],
        severity: 'error'
    }
];
/**
 * Detect missing variables in node text
 */
function detectMissingVars(text, providedVars, entities, actions) {
    const missing = [];
    const lowerText = text.toLowerCase();
    for (const rule of MISSING_VAR_RULES) {
        let triggered = false;
        // Check verb triggers
        if (rule.trigger.verbs) {
            triggered = actions.some(a => rule.trigger.verbs.includes(a.verb.toLowerCase()));
        }
        // Check regex triggers
        if (!triggered && rule.trigger.contains) {
            triggered = rule.trigger.contains.some(re => re.test(text));
        }
        if (!triggered)
            continue;
        // Check each required variable
        for (const req of rule.requires) {
            // 1. Check if provided in vars
            if (providedVars[req.key] !== undefined)
                continue;
            // 2. Check if present in text
            let foundInText = false;
            if (req.detectPresent) {
                foundInText = req.detectPresent.some(re => re.test(text));
            }
            if (foundInText)
                continue;
            // 3. Variable is missing
            missing.push({
                key: req.key,
                hint: req.hint,
                severity: rule.severity
            });
        }
    }
    // Deduplicate by key
    const seen = new Set();
    return missing.filter(m => {
        if (seen.has(m.key))
            return false;
        seen.add(m.key);
        return true;
    });
}
