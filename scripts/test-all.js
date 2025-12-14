#!/usr/bin/env node
// Motherlabs Runtime - Full Test Suite

const { scanForVulnerabilities } = require('../dist/validation/securityScanner');
const { checkAxiomViolations } = require('../dist/validation/axiomChecker');
const { SixGateValidator } = require('../dist/validation/sixGates');
const { runTestExec } = require('../dist/sandbox/runner');
const { classifyDecision, isTCBPath, getTCBClassification, getRequiredGates } = require('../dist/core/decisionClassifier');
const { generateConsequenceSurface, formatConsequenceSurface } = require('../dist/analysis/consequenceSurface');
const { generateAlternatives, hasAdequateAlternatives, formatAlternatives } = require('../dist/core/proposal');
const { checkPrematurity, formatPrematurityCheck } = require('../dist/validation/prematurityChecker');
const { determineGateRequirements, checkGatesSatisfied, formatGateElevation } = require('../dist/validation/gateElevation');
const { detectHollowPatterns, passesHollowDetection, formatHollowResult } = require('../dist/validation/hollowDetector');
const { EvidenceQuery, formatEvidenceEntry } = require('../dist/persistence/evidenceQuery');
const { JSONLLedger } = require('../dist/persistence/jsonlLedger');
const { randomBytes } = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function runAllTests() {
  let passed = 0;
  let failed = 0;

  function check(name, condition) {
    if (condition) {
      console.log(`  ✓ ${name}`);
      passed++;
    } else {
      console.log(`  ✗ ${name}`);
      failed++;
    }
  }

  // ═══════════════════════════════════════════════════════════
  console.log('');
  console.log('=== SECURITY SCANNER TESTS ===');
  console.log('');

  const sec1 = scanForVulnerabilities('export const add = (a: number, b: number) => a + b;');
  check('Safe code passes', sec1.passed && sec1.score === 100);

  const sec2 = scanForVulnerabilities('exec("ls " + userInput);');
  check('Command injection detected', !sec2.passed);

  const sec3 = scanForVulnerabilities('eval(userCode);');
  check('Eval usage detected', !sec3.passed);

  const sec4 = scanForVulnerabilities('const key = "sk-12345678901234567890";');
  check('Hardcoded secret detected', !sec4.passed);

  const sec5 = scanForVulnerabilities('document.innerHTML = userInput;');
  check('XSS vector detected', !sec5.passed);

  // ═══════════════════════════════════════════════════════════
  console.log('');
  console.log('=== AXIOM CHECKER TESTS ===');
  console.log('');

  const ax1 = checkAxiomViolations('if (confidence > 0.8) { admit(); }');
  check('Axiom 1: Probabilistic authority detected', !ax1.passed);

  const ax8 = checkAxiomViolations('ledger.delete(record);');
  check('Axiom 8: Evidence mutation detected', !ax8.passed);

  const ax9 = checkAxiomViolations('capabilities.push("NET");');
  check('Axiom 9: Capability escalation detected', !ax9.passed);

  const ax12 = checkAxiomViolations('if (skipValidation) { apply(); }');
  check('Axiom 12: Bypass flag detected', !ax12.passed);

  const axClean = checkAxiomViolations('export const validate = (x: string) => x.length > 0;');
  check('Clean code passes', axClean.passed);

  // ═══════════════════════════════════════════════════════════
  console.log('');
  console.log('=== 6-GATE VALIDATOR TESTS ===');
  console.log('');

  const validator = new SixGateValidator();

  const g1 = await validator.validate('export const x = 1;', { existingImports: [], existingTypes: [] });
  check('Valid code passes all gates', g1.value.valid);

  const g2 = await validator.validate('const x = 1;', { existingImports: [], existingTypes: [] });
  check('Missing export rejected (Gate 1)', !g2.value.valid);

  const g3 = await validator.validate('export const x = {{{', { existingImports: [], existingTypes: [] });
  check('Syntax error rejected (Gate 2)', !g3.value.valid);

  const g4 = await validator.validate('export function run(x) { return eval(x); }', { existingImports: [], existingTypes: [] });
  check('Eval rejected (Gate 6 security)', !g4.value.valid);

  const g5 = await validator.validate('export const add = (a: number, b: number): number => a + b;', { existingImports: [], existingTypes: [] });
  check('Type-safe code passes', g5.value.valid);

  // ═══════════════════════════════════════════════════════════
  console.log('');
  console.log('=== GATE 4 (KERNEL-GRADE) TESTS ===');
  console.log('');

  const attemptId = randomBytes(4).toString('hex');
  const tempDir = path.join(os.tmpdir(), 'gate4-test-' + attemptId);
  fs.mkdirSync(tempDir, { recursive: true });

  const k1 = await runTestExec({
    attempt_id: attemptId,
    cwd: process.cwd(),
    command: ['node', '-e', 'console.log("test")'],
    env_allowlist: [],
    time_limit_ms: 5000,
    capabilities: ['FS_READ'],
    sandbox_root: tempDir
  });
  check('Allowed command executes', k1.value.ok);

  const k2 = await runTestExec({
    attempt_id: attemptId + '-2',
    cwd: process.cwd(),
    command: ['curl', 'http://example.com'],
    env_allowlist: [],
    time_limit_ms: 5000,
    capabilities: [],
    sandbox_root: tempDir
  });
  check('Disallowed command blocked', !k2.value.ok);

  const k3 = await runTestExec({
    attempt_id: attemptId + '-3',
    cwd: process.cwd(),
    command: ['node', '-e', 'process.exit(1)'],
    env_allowlist: [],
    time_limit_ms: 5000,
    capabilities: [],
    sandbox_root: tempDir
  });
  check('Non-zero exit detected', !k3.value.ok && k3.value.denial?.reason === 'EXIT_NONZERO');

  // Cleanup
  fs.rmSync(tempDir, { recursive: true, force: true });

  // ═══════════════════════════════════════════════════════════
  console.log('');
  console.log('=== DECISION CLASSIFIER TESTS ===');
  console.log('');

  check('TCB: validation path detected', isTCBPath('src/validation/sixGates.ts'));
  check('TCB: sandbox path detected', isTCBPath('src/sandbox/runner.ts'));
  check('TCB: non-TCB path correctly identified', !isTCBPath('src/cli.ts'));
  check('TCB: constitutional doc detected', isTCBPath('docs/MOTHERLABS_CONSTITUTION.md'));

  check('Classification: authority path', getTCBClassification('src/validation/sixGates.ts') === 'authority');
  check('Classification: governed path', getTCBClassification('src/selfbuild/proposer.ts') === 'governed');
  check('Classification: constitutional', getTCBClassification('docs/MOTHERLABS_CONSTITUTION.md') === 'constitutional');

  const testProposal = {
    id: 'test-001',
    targetFile: 'tests/example.test.ts',
    issue: { type: 'NO_TESTS', severity: 'medium', message: 'Test', line: 1 },
    proposedChange: { type: 'add_test', code: 'export const test = () => {}' },
    rationale: 'Test',
    timestamp: Date.now(),
    source: 'llm'
  };

  const testClassification = classifyDecision(testProposal);
  check('Classify: test file is reversible', testClassification.ok && testClassification.value.type === 'reversible');

  const tcbProposal = {
    id: 'test-002',
    targetFile: 'src/validation/sixGates.ts',
    issue: { type: 'HIGH_COMPLEXITY', severity: 'high', message: 'Complex', line: 1 },
    proposedChange: { type: 'refactor', code: '// CONSTITUTIONAL AUTHORITY\nexport type Gate = {}' },
    rationale: 'Test',
    timestamp: Date.now(),
    source: 'llm'
  };

  const tcbClassification = classifyDecision(tcbProposal);
  check('Classify: TCB change is irreversible', tcbClassification.ok && tcbClassification.value.type === 'irreversible');

  const reversibleGates = getRequiredGates({ type: 'reversible', reason: '', requiredEvidence: [], signals: [] });
  check('Gate elevation: reversible needs 4 gates', reversibleGates.gates.length === 4);
  check('Gate elevation: reversible no human approval', !reversibleGates.humanApprovalRequired);

  const irreversibleGates = getRequiredGates({ type: 'irreversible', reason: '', requiredEvidence: [], signals: [] });
  check('Gate elevation: irreversible needs 6 gates', irreversibleGates.gates.length === 6);
  check('Gate elevation: irreversible needs human approval', irreversibleGates.humanApprovalRequired);

  // ═══════════════════════════════════════════════════════════
  console.log('');
  console.log('=== CONSEQUENCE SURFACE TESTS ===');
  console.log('');

  const validationProposal = {
    id: 'test-003',
    targetFile: 'src/validation/sixGates.ts',
    issue: { type: 'HIGH_COMPLEXITY', severity: 'high', message: 'Complex', line: 1 },
    proposedChange: { type: 'refactor', code: 'export function validate() {}' },
    rationale: 'Test',
    timestamp: Date.now(),
    source: 'llm'
  };

  const consequenceResult = generateConsequenceSurface(validationProposal);
  check('Consequence: generates for TCB path', consequenceResult.ok);
  check('Consequence: has enables array', consequenceResult.ok && Array.isArray(consequenceResult.value.surface.enables));
  check('Consequence: has forbids array', consequenceResult.ok && Array.isArray(consequenceResult.value.surface.forbids));
  check('Consequence: validation path is high/critical risk',
        consequenceResult.ok && (consequenceResult.value.riskLevel === 'high' || consequenceResult.value.riskLevel === 'critical'));

  const constitutionalProposal = {
    id: 'test-004',
    targetFile: 'docs/MOTHERLABS_CONSTITUTION.md',
    issue: { type: 'MISSING_TYPES', severity: 'medium', message: 'Test', line: 1 },
    proposedChange: { type: 'modify_function', code: '## New section' },
    rationale: 'Test',
    timestamp: Date.now(),
    source: 'llm'
  };

  const constitutionalConsequence = generateConsequenceSurface(constitutionalProposal);
  check('Consequence: constitutional is critical risk',
        constitutionalConsequence.ok && constitutionalConsequence.value.riskLevel === 'critical');
  check('Consequence: constitutional revert is impossible',
        constitutionalConsequence.ok && constitutionalConsequence.value.reversibilityAssessment.revertCost === 'impossible');

  const testFileProposal = {
    id: 'test-005',
    targetFile: 'tests/example.test.ts',
    issue: { type: 'NO_TESTS', severity: 'low', message: 'Test', line: 1 },
    proposedChange: { type: 'add_test', code: 'describe("test", () => {})' },
    rationale: 'Test',
    timestamp: Date.now(),
    source: 'llm'
  };

  const testConsequence = generateConsequenceSurface(testFileProposal);
  check('Consequence: test file revert is trivial',
        testConsequence.ok && testConsequence.value.reversibilityAssessment.revertCost === 'trivial');

  const formatted = consequenceResult.ok ? formatConsequenceSurface(consequenceResult.value) : '';
  check('Consequence: format includes sections', formatted.includes('ENABLES:') && formatted.includes('FORBIDS:'));

  // ═══════════════════════════════════════════════════════════
  console.log('');
  console.log('=== ALTERNATIVE TRACKING TESTS ===');
  console.log('');

  const errorProposal = {
    id: 'test-006',
    targetFile: 'src/example/service.ts',
    issue: { type: 'NO_ERROR_HANDLING', severity: 'high', message: 'Missing error handling', line: 1 },
    proposedChange: { type: 'modify_function', code: 'export function handle() {}' },
    rationale: 'Test',
    timestamp: Date.now(),
    source: 'llm'
  };

  const altResult = generateAlternatives(errorProposal);
  check('Alternative: generates for proposal', altResult.ok);
  check('Alternative: has alternatives array', altResult.ok && Array.isArray(altResult.value.alternatives));
  check('Alternative: has at least 2 alternatives', altResult.ok && altResult.value.alternatives.length >= 2);
  check('Alternative: includes try-catch', altResult.ok && altResult.value.alternatives.some(a => a.description.includes('try-catch')));
  check('Alternative: includes Result pattern', altResult.ok && altResult.value.alternatives.some(a => a.description.includes('Result')));

  const adequateCheck = altResult.ok ? hasAdequateAlternatives(altResult.value) : false;
  check('Alternative: passes adequate check', adequateCheck);

  const altFormatted = altResult.ok ? formatAlternatives(altResult.value) : '';
  check('Alternative: format includes sections', altFormatted.includes('ALTERNATIVES CONSIDERED') && altFormatted.includes('COMPARISON SUMMARY'));

  // Test complexity alternatives
  const complexProposal = {
    id: 'test-007',
    targetFile: 'src/core/loop.ts',
    issue: { type: 'HIGH_COMPLEXITY', severity: 'medium', message: 'Complex', line: 1 },
    proposedChange: { type: 'refactor', code: 'export function loop() {}' },
    rationale: 'Test',
    timestamp: Date.now(),
    source: 'llm'
  };

  const complexAltResult = generateAlternatives(complexProposal);
  check('Alternative: complexity has helper alternative',
        complexAltResult.ok && complexAltResult.value.alternatives.some(a => a.description.includes('helper')));
  check('Alternative: each has consequence surface',
        complexAltResult.ok && complexAltResult.value.alternatives.every(a => a.consequenceSurface !== undefined));

  // ═══════════════════════════════════════════════════════════
  console.log('');
  console.log('=== PREMATURITY CHECKER TESTS ===');
  console.log('');

  // Critical severity is never premature
  const criticalProposal = {
    id: 'test-008',
    targetFile: 'src/validation/sixGates.ts',
    issue: { type: 'NO_ERROR_HANDLING', severity: 'critical', message: 'Critical security issue', line: 1 },
    proposedChange: { type: 'modify_function', code: 'export function fix() {}' },
    rationale: 'Fixes critical security issue',
    timestamp: Date.now(),
    source: 'llm',
    gateValidation: { valid: true, gateResults: [] }
  };

  const criticalPremResult = checkPrematurity(criticalProposal);
  check('Prematurity: critical severity is NOT premature',
        criticalPremResult.ok && !criticalPremResult.value.premature);

  // Low severity with weak justification is premature
  const weakProposal = {
    id: 'test-009',
    targetFile: 'tests/example.test.ts',
    issue: { type: 'MISSING_TYPES', severity: 'low', message: 'Missing types', line: 1 },
    proposedChange: { type: 'modify_function', code: 'export function x() {}' },
    rationale: 'Fix it',  // Very short
    timestamp: Date.now(),
    source: 'llm'
    // No gateValidation
  };

  const weakPremResult = checkPrematurity(weakProposal);
  check('Prematurity: low severity + weak justification is premature',
        weakPremResult.ok && weakPremResult.value.premature);

  // TODO in code signals prematurity
  const todoProposal = {
    id: 'test-010',
    targetFile: 'src/example/service.ts',
    issue: { type: 'NO_ERROR_HANDLING', severity: 'medium', message: 'Issue', line: 1 },
    proposedChange: { type: 'modify_function', code: '// TODO: implement properly\nexport function stub() {}' },
    rationale: 'Adding implementation because it fixes the error handling issue',
    timestamp: Date.now(),
    source: 'llm',
    gateValidation: { valid: true, gateResults: [] }
  };

  const todoPremResult = checkPrematurity(todoProposal);
  check('Prematurity: TODO in code detected',
        todoPremResult.ok && todoPremResult.value.signals.some(s => s.signal.includes('TODO')));

  // Security issues are blocking (not premature)
  const securityProposal = {
    id: 'test-011',
    targetFile: 'src/auth/validator.ts',
    issue: { type: 'NO_ERROR_HANDLING', severity: 'high', message: 'Security vulnerability in authentication', line: 1 },
    proposedChange: { type: 'modify_function', code: 'export function validate() {}' },
    rationale: 'Fixes security vulnerability',
    timestamp: Date.now(),
    source: 'llm',
    gateValidation: { valid: true, gateResults: [] }
  };

  const securityPremResult = checkPrematurity(securityProposal);
  check('Prematurity: security issues are blocking',
        securityPremResult.ok && securityPremResult.value.signals.some(s => s.weight < 0));

  // Format output works
  const premFormatted = weakPremResult.ok ? formatPrematurityCheck(weakPremResult.value) : '';
  check('Prematurity: format includes sections',
        premFormatted.includes('PREMATURITY ANALYSIS') && premFormatted.includes('SIGNALS:'));

  // ═══════════════════════════════════════════════════════════
  console.log('');
  console.log('=== GATE ELEVATION TESTS ===');
  console.log('');

  // Reversible gets standard level
  const reversibleProposal = {
    id: 'test-012',
    targetFile: 'src/example/helper.ts',
    issue: { type: 'NO_ERROR_HANDLING', severity: 'medium', message: 'Test', line: 1 },
    proposedChange: { type: 'modify_function', code: 'export function test() {}' },
    rationale: 'Test rationale',
    timestamp: Date.now(),
    source: 'llm'
  };

  const reversibleElevation = determineGateRequirements(reversibleProposal, 'reversible');
  check('Elevation: reversible gets standard level',
        reversibleElevation.ok && reversibleElevation.value.level === 'standard');
  check('Elevation: standard has 4 required gates',
        reversibleElevation.ok && reversibleElevation.value.gates.filter(g => g.required).length === 4);

  // Irreversible gets elevated level (using non-architectural change)
  const irreversibleProposal = {
    id: 'test-013',
    targetFile: 'src/services/api.ts',  // Non-TCB, non-architectural
    issue: { type: 'HIGH_COMPLEXITY', severity: 'high', message: 'Complex', line: 1 },
    proposedChange: { type: 'modify_function', code: 'export function handle() { return 1 }' },
    rationale: 'Test rationale',
    timestamp: Date.now(),
    source: 'llm'
  };

  const irreversibleElevation = determineGateRequirements(irreversibleProposal, 'irreversible');
  check('Elevation: irreversible gets elevated level',
        irreversibleElevation.ok && irreversibleElevation.value.level === 'elevated');
  check('Elevation: elevated requires human approval',
        irreversibleElevation.ok && irreversibleElevation.value.humanApprovalRequired);
  check('Elevation: elevated has 6 required gates',
        irreversibleElevation.ok && irreversibleElevation.value.gates.filter(g => g.required).length === 6);

  // Constitutional gets maximum level
  const constitutionalElevProposal = {
    id: 'test-014',
    targetFile: 'docs/MOTHERLABS_CONSTITUTION.md',
    issue: { type: 'MISSING_TYPES', severity: 'medium', message: 'Update', line: 1 },
    proposedChange: { type: 'modify_function', code: '## New section' },
    rationale: 'Test',
    timestamp: Date.now(),
    source: 'llm'
  };

  const constitutionalElevation = determineGateRequirements(constitutionalElevProposal, 'irreversible');
  check('Elevation: constitutional gets maximum level',
        constitutionalElevation.ok && constitutionalElevation.value.level === 'maximum');

  // Gate satisfaction check
  if (irreversibleElevation.ok) {
    const allPass = checkGatesSatisfied(irreversibleElevation.value, [
      { gateName: 'schema_validation', passed: true },
      { gateName: 'syntax_validation', passed: true },
      { gateName: 'variable_resolution', passed: true },
      { gateName: 'test_execution', passed: true },
      { gateName: 'urco_entropy', passed: true },
      { gateName: 'governance_check', passed: true }
    ]);
    check('Elevation: all gates passing is satisfied', allPass.satisfied);

    const oneFail = checkGatesSatisfied(irreversibleElevation.value, [
      { gateName: 'schema_validation', passed: true },
      { gateName: 'syntax_validation', passed: false },
      { gateName: 'variable_resolution', passed: true },
      { gateName: 'test_execution', passed: true },
      { gateName: 'urco_entropy', passed: true },
      { gateName: 'governance_check', passed: true }
    ]);
    check('Elevation: one gate failing is not satisfied', !oneFail.satisfied);
  }

  // Format output
  const elevFormatted = irreversibleElevation.ok ? formatGateElevation(irreversibleElevation.value) : '';
  check('Elevation: format includes sections',
        elevFormatted.includes('GATE ELEVATION PROTOCOL') && elevFormatted.includes('GATE REQUIREMENTS:'));

  // ═══════════════════════════════════════════════════════════
  console.log('');
  console.log('=== HOLLOW DETECTOR TESTS ===');
  console.log('');

  // Empty function detection
  const emptyFuncCode = `
export function doNothing() {
}
`;
  const emptyFuncResult = detectHollowPatterns(emptyFuncCode);
  check('Hollow: empty function detected',
        emptyFuncResult.ok && emptyFuncResult.value.patterns.some(p => p.type === 'EMPTY_FUNCTION'));

  // Return-only function detection
  const returnOnlyCode = `
export function alwaysTrue(): boolean {
  return true
}
`;
  const returnOnlyResult = detectHollowPatterns(returnOnlyCode);
  check('Hollow: return-only function detected',
        returnOnlyResult.ok && returnOnlyResult.value.patterns.some(p => p.type === 'RETURN_ONLY'));

  // Not implemented error detection
  const notImplCode = `
export function futureFeature() {
  throw new Error('Not implemented yet')
}
`;
  const notImplResult = detectHollowPatterns(notImplCode);
  check('Hollow: not implemented detected',
        notImplResult.ok && notImplResult.value.patterns.some(p => p.type === 'NOT_IMPLEMENTED'));

  // Empty catch block detection
  const emptyCatchCode = `
export function risky() {
  try {
    doSomething()
  } catch (e) {
  }
}
`;
  const emptyCatchResult = detectHollowPatterns(emptyCatchCode);
  check('Hollow: empty catch detected',
        emptyCatchResult.ok && emptyCatchResult.value.patterns.some(p => p.type === 'EMPTY_CATCH'));

  // Clean code passes
  const cleanCode = `
export function calculate(a: number, b: number): number {
  const result = a + b
  if (result < 0) {
    throw new Error('Negative result')
  }
  return result
}
`;
  const cleanResult = detectHollowPatterns(cleanCode);
  check('Hollow: clean code passes',
        cleanResult.ok && passesHollowDetection(cleanResult.value));

  // Multi-line detection (key feature)
  const multiLineCode = `
export function complexHollow(
  param1: string,
  param2: number,
  param3: boolean
): string {
  throw new Error('Not implemented')
}
`;
  const multiLineResult = detectHollowPatterns(multiLineCode);
  check('Hollow: multi-line function detected',
        multiLineResult.ok && multiLineResult.value.patterns.length > 0);

  // Hollow score calculation (needs substantial code to get full penalty)
  const veryHollowCode = `
// File with multiple hollow patterns
// This file demonstrates hollow code detection
// across a larger codebase file

export function emptyOne() {}
export function emptyTwo() {}
export function emptyThree() {}

export function returnTrue(): boolean { return true }
export function returnFalse(): boolean { return false }
export function returnNull(): null { return null }

export function notImpl1() { throw new Error('Not implemented') }
export function notImpl2() { throw new Error('TODO: implement') }

// More filler to get past the size threshold
export const CONFIG = { enabled: true };
export const VERSION = '1.0.0';
// Additional lines for proper size calculation
`;
  const veryHollowResult = detectHollowPatterns(veryHollowCode);
  check('Hollow: very hollow code has low score',
        veryHollowResult.ok && veryHollowResult.value.hollowScore < 80);

  // Format output
  const hollowFormatted = notImplResult.ok ? formatHollowResult(notImplResult.value) : '';
  check('Hollow: format includes sections',
        hollowFormatted.includes('HOLLOW CODE DETECTION') && hollowFormatted.includes('Hollow Score:'));

  // Integration with 6-gate validation
  const hollowTestCode = `
export function stub() {
  throw new Error('Not implemented')
}
`;
  const gateResult = await validator.validate(hollowTestCode, { existingImports: [], existingTypes: [] });
  check('Hollow: integrated into Gate 6',
        !gateResult.value.valid && gateResult.value.gateResults.some(g =>
          g.gateName === 'governance_check' && !g.passed));

  // ═══════════════════════════════════════════════════════════
  console.log('');
  console.log('=== EVIDENCE QUERY TESTS ===');
  console.log('');

  // Setup: Create test ledger
  const evidenceTestId = randomBytes(4).toString('hex');
  const evidenceTempDir = path.join(os.tmpdir(), `evidence-test-${evidenceTestId}`);
  fs.mkdirSync(evidenceTempDir, { recursive: true });
  const evidenceLedgerPath = path.join(evidenceTempDir, 'test-ledger.jsonl');

  const testLedger = new JSONLLedger(evidenceLedgerPath);
  await testLedger.append('PROPOSAL', {
    proposalId: 'test-prop-001',
    targetFile: 'src/core/result.ts',
    decisionType: 'reversible',
    issueType: 'NO_ERROR_HANDLING',
    severity: 'high',
    source: 'llm',
    rationale: 'Adding Result type'
  });
  await testLedger.append('PROPOSAL', {
    proposalId: 'test-prop-002',
    targetFile: 'src/validation/sixGates.ts',
    decisionType: 'irreversible',
    issueType: 'HIGH_COMPLEXITY',
    severity: 'critical',
    source: 'llm'
  });

  const evidenceQuery = new EvidenceQuery(evidenceLedgerPath);
  check('Evidence: query initializes', evidenceQuery.count() > 0);

  const byFileResult = evidenceQuery.byFile('src/core/result.ts');
  check('Evidence: byFile works', byFileResult.ok && byFileResult.value.length >= 1);

  const byTypeResult = evidenceQuery.byDecisionType('reversible');
  check('Evidence: byDecisionType works', byTypeResult.ok && byTypeResult.value.length >= 1);

  const statsResult = evidenceQuery.getStats();
  check('Evidence: getStats works', statsResult.ok && statsResult.value.totalEntries > 0);

  const searchResult = evidenceQuery.search('Result');
  check('Evidence: search works', searchResult.ok && searchResult.value.length >= 1);

  const integrityResult = evidenceQuery.verifyIntegrity();
  check('Evidence: integrity verification passes', integrityResult.ok);

  // Get all entries and test context reconstruction
  const allEntries = evidenceQuery.query({});
  if (allEntries.ok && allEntries.value.length > 1) {
    const contextResult = evidenceQuery.reconstructContext(allEntries.value[1].id);
    check('Evidence: reconstructContext works', contextResult.ok);
  } else {
    check('Evidence: reconstructContext works', false);
  }

  // Cleanup
  fs.rmSync(evidenceTempDir, { recursive: true, force: true });

  // ═══════════════════════════════════════════════════════════
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  TOTAL: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

runAllTests().catch(err => {
  console.error('Test suite error:', err.message);
  process.exit(1);
});
