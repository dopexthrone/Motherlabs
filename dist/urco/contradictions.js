"use strict";
// URCO v0.2 - Contradiction Detection (Real patterns, no simulation)
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectContradictions = detectContradictions;
const extractor_1 = require("./extractor");
/**
 * Detect contradictions in node text using deterministic patterns
 */
function detectContradictions(text) {
    const contradictions = [];
    // A. Explicit negation clashes
    const negationRegex = /\b(do not|dont|never|no)\s+(allow|use|include|enable)\s+([^.;,\n]{2,60})/gi;
    const positiveRegex = /\b(allow|use|include|enable)\s+([^.;,\n]{2,60})/gi;
    const negations = [];
    const positives = [];
    for (const match of text.matchAll(negationRegex)) {
        negations.push({
            text: match[3],
            span: [match.index, match.index + match[0].length]
        });
    }
    for (const match of text.matchAll(positiveRegex)) {
        positives.push({
            text: match[2],
            span: [match.index, match.index + match[0].length]
        });
    }
    // Check for overlap
    for (const neg of negations) {
        for (const pos of positives) {
            const overlap = (0, extractor_1.tokenOverlap)(neg.text, pos.text);
            if (overlap >= 0.7) {
                contradictions.push({
                    type: 'negation_clash',
                    leftSpan: neg.span,
                    rightSpan: pos.span,
                    explanation: `"do not ${neg.text}" conflicts with "allow ${pos.text}"`,
                    confidence: 'high'
                });
            }
        }
    }
    // B. Mutually exclusive modality (must vs optional)
    const mustRegex = /\bmust\s+([^.;,\n]{2,60})/gi;
    const optionalRegex = /\boptional\s+([^.;,\n]{2,60})/gi;
    const musts = [];
    const optionals = [];
    for (const match of text.matchAll(mustRegex)) {
        musts.push({
            text: match[1],
            span: [match.index, match.index + match[0].length]
        });
    }
    for (const match of text.matchAll(optionalRegex)) {
        optionals.push({
            text: match[1],
            span: [match.index, match.index + match[0].length]
        });
    }
    for (const must of musts) {
        for (const opt of optionals) {
            const overlap = (0, extractor_1.tokenOverlap)(must.text, opt.text);
            if (overlap >= 0.7) {
                contradictions.push({
                    type: 'modality_conflict',
                    leftSpan: must.span,
                    rightSpan: opt.span,
                    explanation: `"must ${must.text}" conflicts with "optional ${opt.text}"`,
                    confidence: 'high'
                });
            }
        }
    }
    // C. Numerical range conflict
    const numConstraintRegex = /\b([a-zA-Z_][a-zA-Z0-9_ ]{1,40})\s*(<=|<|>=|>|=)\s*(\d+(?:\.\d+)?)/g;
    const constraints = [];
    for (const match of text.matchAll(numConstraintRegex)) {
        constraints.push({
            variable: (0, extractor_1.normalize)(match[1]),
            operator: match[2],
            value: parseFloat(match[3]),
            span: [match.index, match.index + match[0].length]
        });
    }
    // Check for impossible combinations
    for (let i = 0; i < constraints.length; i++) {
        for (let j = i + 1; j < constraints.length; j++) {
            const c1 = constraints[i];
            const c2 = constraints[j];
            // Same variable?
            if ((0, extractor_1.tokenOverlap)(c1.variable, c2.variable) < 0.8)
                continue;
            // Check for conflicts
            let conflict = false;
            let explanation = '';
            if (c1.operator === '=' && c2.operator === '=' && c1.value !== c2.value) {
                conflict = true;
                explanation = `${c1.variable} = ${c1.value} conflicts with ${c2.variable} = ${c2.value}`;
            }
            else if ((c1.operator === '<=' || c1.operator === '<') &&
                (c2.operator === '>=' || c2.operator === '>') &&
                c1.value < c2.value) {
                conflict = true;
                explanation = `${c1.variable} ${c1.operator} ${c1.value} conflicts with ${c2.variable} ${c2.operator} ${c2.value}`;
            }
            if (conflict) {
                contradictions.push({
                    type: 'numeric_range_conflict',
                    leftSpan: c1.span,
                    rightSpan: c2.span,
                    explanation,
                    confidence: 'high'
                });
            }
        }
    }
    // D. Environment conflict (no deps vs use library)
    const noDepsRegex = /\b(no dependencies|zero deps|no deps|no external)\b/i;
    const useDepsRegex = /\b(use|install|add|import)\s+([a-z0-9_\-]+)\b/gi;
    if (noDepsRegex.test(text)) {
        const noDepsMatch = text.match(noDepsRegex);
        for (const match of text.matchAll(useDepsRegex)) {
            contradictions.push({
                type: 'deps_conflict',
                leftSpan: [text.indexOf(noDepsMatch[0]), text.indexOf(noDepsMatch[0]) + noDepsMatch[0].length],
                rightSpan: [match.index, match.index + match[0].length],
                explanation: `"no dependencies" conflicts with "${match[1]} ${match[2]}"`,
                confidence: 'high'
            });
        }
    }
    // E. Logging conflict (no logs vs must log)
    const noLogsRegex = /\b(no logs|do not log|no logging)\b/i;
    const mustLogRegex = /\b(log|evidence ledger|audit trail|must log)\b/i;
    const noLogsMatch = text.match(noLogsRegex);
    const mustLogMatch = text.match(mustLogRegex);
    if (noLogsMatch && mustLogMatch) {
        contradictions.push({
            type: 'logging_conflict',
            leftSpan: [text.indexOf(noLogsMatch[0]), text.indexOf(noLogsMatch[0]) + noLogsMatch[0].length],
            rightSpan: [text.indexOf(mustLogMatch[0]), text.indexOf(mustLogMatch[0]) + mustLogMatch[0].length],
            explanation: `"${noLogsMatch[0]}" conflicts with "${mustLogMatch[0]}"`,
            confidence: 'high'
        });
    }
    return contradictions;
}
