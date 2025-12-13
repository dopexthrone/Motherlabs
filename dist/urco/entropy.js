"use strict";
// URCO v0.2 - Entropy Calculation (Real formula, exact implementation)
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeEntropy = computeEntropy;
exports.entropyImproved = entropyImproved;
/**
 * Compute node entropy H(P) as specified:
 * H(P) = clamp01(αU·U(P) + αA·Amb(P) + αC·Con(P) + αS·SpecDef(P) + αD·Dep(P) + αV·Ver(P))
 *
 * Weights (sum to 1.00):
 * αU = 0.22, αA = 0.16, αC = 0.22, αS = 0.18, αD = 0.10, αV = 0.12
 */
const WEIGHTS = {
    unknowns: 0.22,
    ambiguity: 0.16,
    contradiction: 0.22,
    specificityDeficit: 0.18,
    dependencyUncertainty: 0.10,
    verifiabilityDeficit: 0.12
};
function clamp01(x) {
    return Math.max(0, Math.min(1, x));
}
/**
 * U(P): Unknowns ratio
 * Measures underspecified variables
 */
function computeUnknowns(data) {
    const requiredSlots = ['goal', 'inputs', 'outputs', 'constraints', 'acceptanceCriteria', 'invariants'];
    let missing = 0;
    // Check goal (derived from text presence)
    if (!data.text || data.text.length < 10)
        missing++;
    // Check other slots
    if (!data.inputs || (Array.isArray(data.inputs) && data.inputs.length === 0))
        missing++;
    if (!data.outputs || (Array.isArray(data.outputs) && data.outputs.length === 0))
        missing++;
    if (!data.constraints || (Array.isArray(data.constraints) && data.constraints.length === 0))
        missing++;
    if (!data.acceptanceCriteria || (Array.isArray(data.acceptanceCriteria) && data.acceptanceCriteria.length === 0))
        missing++;
    if (!data.invariants || (Array.isArray(data.invariants) && data.invariants.length === 0))
        missing++;
    return missing / requiredSlots.length;
}
/**
 * Amb(P): Ambiguity score
 * Vague terms + unclear pronouns
 */
function computeAmbiguity(data) {
    const text = data.text;
    // Vague terms dictionary (expanded)
    const vagueTerms = ['better', 'optimize', 'handle', 'manage', 'robust', 'scalable', 'real', 'correct', 'fast', 'easy', 'good', 'improve', 'thing', 'stuff', 'something', 'it', 'nice', 'well'];
    let vagueCount = 0;
    for (const term of vagueTerms) {
        const regex = new RegExp(`\\b${term}\\b`, 'gi');
        const matches = text.match(regex);
        if (matches)
            vagueCount += matches.length;
    }
    let score = clamp01(vagueCount / 3); // More sensitive threshold
    // Unclear pronouns
    const pronounRegex = /\b(it|this|that|them|those)\b/gi;
    const pronounMatches = text.match(pronounRegex);
    if (pronounMatches && pronounMatches.length > 1) { // Lower threshold
        score += 0.2;
    }
    // Very short text is inherently ambiguous
    if (text.length < 30) {
        score += 0.3;
    }
    return clamp01(score);
}
/**
 * Con(P): Contradiction score
 * 1.0 if hard contradiction, proportional otherwise
 */
function computeContradiction(contradictions) {
    const highConfidence = contradictions.filter(c => c.confidence === 'high');
    if (highConfidence.length > 0) {
        return 1.0; // Hard fail
    }
    // Medium confidence: proportional
    return clamp01(contradictions.length * 0.3);
}
/**
 * SpecDef(P): Specificity deficit
 * Checks for numeric thresholds, explicit interfaces, acceptance tests, ordering rules
 */
function computeSpecificityDeficit(data) {
    let presentCount = 0;
    const maxPoints = 4;
    // 1. Numeric thresholds/bounds
    if (/\b\d+(?:\.\d+)?\s*(ms|MB|KB|%|sec|min)\b/i.test(data.text) ||
        /\b(threshold|limit|cap|max|min|bound)\s*[:=]\s*\d+/i.test(data.text)) {
        presentCount++;
    }
    // 2. Explicit interfaces (typed inputs/outputs)
    if ((data.inputs && data.inputs.length > 0) ||
        (data.outputs && data.outputs.length > 0) ||
        /\b(input|output|return|param|argument)\s*:\s*[A-Za-z]/i.test(data.text)) {
        presentCount++;
    }
    // 3. Acceptance test statement
    if (data.acceptanceCriteria && data.acceptanceCriteria.length > 0) {
        presentCount++;
    }
    // 4. Deterministic ordering/tie-break rule
    if (/\b(order|sort|rank|priority|tie-?break)\s*(by|using|on)/i.test(data.text) ||
        /\b(first|then|next|finally)\b/i.test(data.text)) {
        presentCount++;
    }
    return 1 - (presentCount / maxPoints);
}
/**
 * Dep(P): Dependency uncertainty
 * Unpinned external dependencies
 */
function computeDependencyUncertainty(data) {
    const text = data.text;
    // Look for unpinned dependencies
    let unpinnedCount = 0;
    // Pattern: "use X" without version
    const useRegex = /\b(use|install|add|import|require)\s+([a-z0-9_\-@\/]+)/gi;
    for (const match of text.matchAll(useRegex)) {
        const dep = match[2];
        // Check if version is nearby
        const context = text.substring(Math.max(0, match.index - 20), match.index + match[0].length + 30);
        if (!/[@:]\d+\.\d+|version|v\d+/i.test(context)) {
            unpinnedCount++;
        }
    }
    // Pattern: "call web/api" without specific endpoint
    const apiRegex = /\b(call|fetch|request|api|web|http)\b/gi;
    const apiMatches = text.match(apiRegex);
    if (apiMatches && apiMatches.length > 0) {
        // Check if there's a specific URL or endpoint defined
        if (!/https?:\/\/|\/api\/[a-z]/i.test(text)) {
            unpinnedCount++;
        }
    }
    return clamp01(unpinnedCount / 3);
}
/**
 * Ver(P): Verifiability deficit
 * Claims without evidence routes
 */
function computeVerifiabilityDeficit(data) {
    const text = data.text;
    // Detect factual/performance/threshold claims
    const claimPatterns = [
        /\b(will|must|shall|guarantees?|ensures?)\s+[a-z]/i,
        /\b(faster|slower|better|worse|more|less)\s+than/i,
        /\b(threshold|limit|cap)\s*[:=]\s*\d+/i,
        /\b(performance|latency|throughput)\b/i
    ];
    const hasClaim = claimPatterns.some(p => p.test(text));
    if (!hasClaim) {
        return 0.0; // No claims = no verifiability requirement
    }
    // Check for evidence plan
    if (data.evidencePlan) {
        return 0.0; // Evidence plan exists
    }
    // Check for inline test/verification mention
    const evidenceKeywords = /\b(test|verify|check|validate|benchmark|measure|prove|demonstrate)\b/i;
    if (evidenceKeywords.test(text)) {
        return 0.3; // Partial credit for mentioning verification
    }
    return 1.0; // Claim without evidence route
}
/**
 * Main entropy calculation
 */
function computeEntropy(data, missingVars, contradictions) {
    const breakdown = {
        unknowns: computeUnknowns(data),
        ambiguity: computeAmbiguity(data),
        contradiction: computeContradiction(contradictions),
        specificityDeficit: computeSpecificityDeficit(data),
        dependencyUncertainty: computeDependencyUncertainty(data),
        verifiabilityDeficit: computeVerifiabilityDeficit(data)
    };
    const value = clamp01(WEIGHTS.unknowns * breakdown.unknowns +
        WEIGHTS.ambiguity * breakdown.ambiguity +
        WEIGHTS.contradiction * breakdown.contradiction +
        WEIGHTS.specificityDeficit * breakdown.specificityDeficit +
        WEIGHTS.dependencyUncertainty * breakdown.dependencyUncertainty +
        WEIGHTS.verifiabilityDeficit * breakdown.verifiabilityDeficit);
    return { value, breakdown };
}
/**
 * Check if entropy improved (reduced by at least threshold)
 */
function entropyImproved(before, after, minImprovement = 0.15) {
    return (before - after) >= minImprovement;
}
