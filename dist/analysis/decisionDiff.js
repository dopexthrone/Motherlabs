"use strict";
// Decision Diff/Simulation - Answer "what if we had chosen differently?"
// CONSTITUTIONAL AUTHORITY - See docs/MOTHERLABS_CONSTITUTION.md
// Enforces: AXIOM 3 (Reversibility Over Optimization)
// Recoverability through understanding, not just rollback
//
// From ROADMAP Step 7:
// - Given a past decision, simulate alternative path
// - Compare consequence surfaces
// - Identify what would be different today
Object.defineProperty(exports, "__esModule", { value: true });
exports.simulateAlternative = simulateAlternative;
exports.analyzeWhatIf = analyzeWhatIf;
exports.compareDecisions = compareDecisions;
exports.getDivergenceTimeline = getDivergenceTimeline;
exports.formatSimulationResult = formatSimulationResult;
exports.formatWhatIfAnalysis = formatWhatIfAnalysis;
const result_1 = require("../core/result");
/**
 * Simulate an alternative path for a past decision
 * This is the core "what if" capability
 */
function simulateAlternative(originalDecision, alternativeDescription, alternativeApproach) {
    try {
        // 1. Build current state consequence surface from the decision
        const currentState = buildConsequenceSurfaceFromEntry(originalDecision);
        // 2. Build alternative state consequence surface
        const alternativeState = buildAlternativeConsequenceSurface(originalDecision, alternativeDescription, alternativeApproach);
        // 3. Compute the diff
        const diff = computeConsequenceDiff(currentState, alternativeState);
        // 4. Assess impact
        const impact = assessImpact(diff, originalDecision);
        // 5. Build simulation result
        return (0, result_1.Ok)({
            originalDecision,
            simulatedAlternative: {
                id: `alt-${originalDecision.id}`,
                description: alternativeDescription,
                approach: alternativeApproach || 'Unknown approach'
            },
            currentState,
            alternativeState,
            diff,
            impact,
            divergencePoint: {
                timestamp: originalDecision.timestamp,
                decisionId: originalDecision.id,
                description: `Decision point: ${originalDecision.data.issueType || originalDecision.type}`
            }
        });
    }
    catch (error) {
        return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
    }
}
/**
 * Analyze what-if scenario given a question
 */
function analyzeWhatIf(decisionContext, alternativeIndex) {
    try {
        const entry = decisionContext.entry;
        // Get the consequence surface from context or build it
        const originalConsequence = decisionContext.consequenceSurface ||
            buildConsequenceSurfaceFromEntry(entry);
        // If no alternatives recorded, generate a hypothetical one
        let alternativeDescription = 'Alternative approach';
        let alternativeConsequence;
        if (decisionContext.alternatives && decisionContext.alternatives[alternativeIndex]) {
            const alt = decisionContext.alternatives[alternativeIndex];
            alternativeDescription = alt.description;
            alternativeConsequence = buildAlternativeConsequenceSurface(entry, alt.description, alt.rejectionReason);
        }
        else {
            // Generate hypothetical alternative based on decision type
            alternativeConsequence = generateHypotheticalAlternative(entry);
            alternativeDescription = 'Hypothetical alternative (deferred action)';
        }
        const diff = computeConsequenceDiff(originalConsequence, alternativeConsequence);
        // Generate recommendation
        const recommendation = generateRecommendation(diff, entry);
        return (0, result_1.Ok)({
            question: `What if we had chosen "${alternativeDescription}" instead?`,
            originalPath: {
                description: `Chosen: ${entry.data.issueType || entry.type}`,
                consequence: originalConsequence
            },
            alternativePath: {
                description: alternativeDescription,
                consequence: alternativeConsequence
            },
            diff,
            recommendation
        });
    }
    catch (error) {
        return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
    }
}
/**
 * Compare two decisions and their consequences
 */
function compareDecisions(decision1, decision2) {
    try {
        const surface1 = buildConsequenceSurfaceFromEntry(decision1);
        const surface2 = buildConsequenceSurfaceFromEntry(decision2);
        return (0, result_1.Ok)(computeConsequenceDiff(surface1, surface2));
    }
    catch (error) {
        return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
    }
}
/**
 * Get divergence timeline - what decisions led to current state
 */
function getDivergenceTimeline(query, targetFile) {
    try {
        const historyResult = query.getFileHistory(targetFile);
        if (!historyResult.ok)
            return (0, result_1.Err)(historyResult.error);
        const timeline = historyResult.value.map(entry => {
            // Extract alternatives if recorded
            const alternatives = [];
            if (entry.data.alternativesConsidered) {
                alternatives.push(`${entry.data.alternativesConsidered} alternatives were considered`);
            }
            // Add hypothetical alternatives based on decision type
            if (entry.data.decisionType === 'irreversible') {
                alternatives.push('Could have deferred this decision');
            }
            return { entry, alternatives };
        });
        return (0, result_1.Ok)(timeline);
    }
    catch (error) {
        return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
    }
}
/**
 * Build consequence surface from evidence entry
 */
function buildConsequenceSurfaceFromEntry(entry) {
    return {
        enables: entry.data.enables || [],
        forbids: entry.data.forbids || [],
        assumptions: entry.data.assumptions || [],
        validationCriteria: []
    };
}
/**
 * Build alternative consequence surface
 */
function buildAlternativeConsequenceSurface(original, alternativeDescription, approach) {
    // Generate alternative consequences based on the description
    const enables = [];
    const forbids = [];
    const assumptions = [];
    // If original enables something, alternative might not
    const originalEnables = original.data.enables || [];
    const originalForbids = original.data.forbids || [];
    // Invert some consequences for simulation
    if (alternativeDescription.toLowerCase().includes('defer')) {
        enables.push('More time for analysis');
        enables.push('Flexibility preserved');
        forbids.push('Immediate resolution');
        assumptions.push('Issue can wait');
    }
    else if (alternativeDescription.toLowerCase().includes('simple')) {
        enables.push('Faster implementation');
        enables.push('Lower risk of bugs');
        forbids.push('Advanced features');
        assumptions.push('Simpler solution is adequate');
    }
    else if (alternativeDescription.toLowerCase().includes('refactor')) {
        enables.push('Better code structure');
        enables.push('Improved maintainability');
        forbids.push('Backward compatibility');
        assumptions.push('Breaking changes acceptable');
    }
    else {
        // Generic alternative
        enables.push('Alternative approach benefits');
        forbids.push('Original approach benefits');
        assumptions.push('Alternative would work');
    }
    // What original forbids, alternative might enable
    for (const forbid of originalForbids.slice(0, 2)) {
        enables.push(`Preserved: ${forbid}`);
    }
    // What original enables, alternative might not
    for (const enable of originalEnables.slice(0, 2)) {
        forbids.push(`Lost: ${enable}`);
    }
    return {
        enables,
        forbids,
        assumptions,
        validationCriteria: []
    };
}
/**
 * Generate hypothetical alternative for simulation
 */
function generateHypotheticalAlternative(entry) {
    const enables = [];
    const forbids = [];
    const assumptions = [];
    // Based on decision type, generate what deferral would have meant
    if (entry.data.decisionType === 'irreversible') {
        enables.push('Option space preserved');
        enables.push('More information gathered');
        enables.push('Reversibility maintained');
        forbids.push('Immediate progress');
        forbids.push('Current implementation benefits');
        assumptions.push('Decision could wait');
        assumptions.push('Deferral cost was low');
    }
    else {
        enables.push('Different trade-offs');
        forbids.push('Chosen approach benefits');
        assumptions.push('Alternative viable');
    }
    return {
        enables,
        forbids,
        assumptions,
        validationCriteria: []
    };
}
/**
 * Compute diff between two consequence surfaces
 */
function computeConsequenceDiff(chosen, alternative) {
    const chosenEnables = new Set(chosen.enables);
    const altEnables = new Set(alternative.enables);
    const chosenForbids = new Set(chosen.forbids);
    const altForbids = new Set(alternative.forbids);
    const chosenAssumptions = new Set(chosen.assumptions);
    const altAssumptions = new Set(alternative.assumptions);
    return {
        uniqueEnables: [...chosenEnables].filter(e => !altEnables.has(e)),
        alternativeEnables: [...altEnables].filter(e => !chosenEnables.has(e)),
        uniqueForbids: [...chosenForbids].filter(f => !altForbids.has(f)),
        alternativeForbids: [...altForbids].filter(f => !chosenForbids.has(f)),
        sharedEnables: [...chosenEnables].filter(e => altEnables.has(e)),
        sharedForbids: [...chosenForbids].filter(f => altForbids.has(f)),
        assumptionDiff: {
            onlyChosen: [...chosenAssumptions].filter(a => !altAssumptions.has(a)),
            onlyAlternative: [...altAssumptions].filter(a => !chosenAssumptions.has(a)),
            shared: [...chosenAssumptions].filter(a => altAssumptions.has(a))
        }
    };
}
/**
 * Assess impact of the difference
 */
function assessImpact(diff, entry) {
    const totalUnique = diff.uniqueEnables.length + diff.uniqueForbids.length;
    const totalAlternative = diff.alternativeEnables.length + diff.alternativeForbids.length;
    let severity;
    if (totalUnique > 4 || totalAlternative > 4) {
        severity = 'high';
    }
    else if (totalUnique > 2 || totalAlternative > 2) {
        severity = 'medium';
    }
    else {
        severity = 'low';
    }
    const reversible = entry.data.decisionType !== 'irreversible';
    const summary = severity === 'high'
        ? `Significant divergence: ${totalUnique} unique consequences in chosen path, ${totalAlternative} in alternative`
        : severity === 'medium'
            ? `Moderate divergence: paths differ in several consequences`
            : `Minor divergence: paths are largely equivalent`;
    return { severity, reversible, summary };
}
/**
 * Generate recommendation based on diff
 */
function generateRecommendation(diff, entry) {
    const parts = [];
    if (diff.alternativeEnables.length > diff.uniqueEnables.length) {
        parts.push('Alternative path may have offered more capabilities.');
    }
    if (diff.uniqueForbids.length > diff.alternativeForbids.length) {
        parts.push('Chosen path closed more doors than alternative.');
    }
    if (entry.data.decisionType === 'irreversible') {
        parts.push('This was an irreversible decision - consider similar situations carefully in future.');
    }
    if (diff.assumptionDiff.onlyChosen.length > 0) {
        parts.push(`Chosen path assumed: ${diff.assumptionDiff.onlyChosen.join(', ')}`);
    }
    if (parts.length === 0) {
        parts.push('The chosen path appears reasonable given the trade-offs.');
    }
    return parts.join(' ');
}
/**
 * Format simulation result for display
 */
function formatSimulationResult(result) {
    const lines = [];
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('DECISION SIMULATION: What If Analysis');
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('');
    // Divergence point
    lines.push(`DIVERGENCE POINT:`);
    lines.push(`  Decision: ${result.divergencePoint.decisionId}`);
    lines.push(`  Date: ${new Date(result.divergencePoint.timestamp).toISOString()}`);
    lines.push(`  Description: ${result.divergencePoint.description}`);
    lines.push('');
    // Simulated alternative
    lines.push(`SIMULATED ALTERNATIVE:`);
    lines.push(`  ${result.simulatedAlternative.description}`);
    if (result.simulatedAlternative.approach !== 'Unknown approach') {
        lines.push(`  Approach: ${result.simulatedAlternative.approach}`);
    }
    lines.push('');
    // Current state vs alternative
    lines.push('CONSEQUENCE COMPARISON:');
    lines.push('');
    lines.push('  CHOSEN PATH ENABLES (unique):');
    if (result.diff.uniqueEnables.length > 0) {
        for (const e of result.diff.uniqueEnables) {
            lines.push(`    + ${e}`);
        }
    }
    else {
        lines.push('    (none unique)');
    }
    lines.push('');
    lines.push('  ALTERNATIVE WOULD ENABLE:');
    if (result.diff.alternativeEnables.length > 0) {
        for (const e of result.diff.alternativeEnables) {
            lines.push(`    + ${e}`);
        }
    }
    else {
        lines.push('    (none unique)');
    }
    lines.push('');
    lines.push('  CHOSEN PATH FORBIDS (unique):');
    if (result.diff.uniqueForbids.length > 0) {
        for (const f of result.diff.uniqueForbids) {
            lines.push(`    - ${f}`);
        }
    }
    else {
        lines.push('    (none unique)');
    }
    lines.push('');
    lines.push('  ALTERNATIVE WOULD FORBID:');
    if (result.diff.alternativeForbids.length > 0) {
        for (const f of result.diff.alternativeForbids) {
            lines.push(`    - ${f}`);
        }
    }
    else {
        lines.push('    (none unique)');
    }
    lines.push('');
    // Impact
    lines.push('IMPACT ASSESSMENT:');
    lines.push(`  Severity: ${result.impact.severity.toUpperCase()}`);
    lines.push(`  Reversible: ${result.impact.reversible ? 'Yes' : 'No'}`);
    lines.push(`  Summary: ${result.impact.summary}`);
    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════');
    return lines.join('\n');
}
/**
 * Format what-if analysis for display
 */
function formatWhatIfAnalysis(analysis) {
    const lines = [];
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('WHAT-IF ANALYSIS');
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('');
    lines.push(`Question: ${analysis.question}`);
    lines.push('');
    lines.push('ORIGINAL PATH:');
    lines.push(`  ${analysis.originalPath.description}`);
    lines.push(`  Enables: ${analysis.originalPath.consequence.enables.join(', ') || 'None'}`);
    lines.push(`  Forbids: ${analysis.originalPath.consequence.forbids.join(', ') || 'None'}`);
    lines.push('');
    lines.push('ALTERNATIVE PATH:');
    lines.push(`  ${analysis.alternativePath.description}`);
    lines.push(`  Enables: ${analysis.alternativePath.consequence.enables.join(', ') || 'None'}`);
    lines.push(`  Forbids: ${analysis.alternativePath.consequence.forbids.join(', ') || 'None'}`);
    lines.push('');
    lines.push('RECOMMENDATION:');
    lines.push(`  ${analysis.recommendation}`);
    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════');
    return lines.join('\n');
}
