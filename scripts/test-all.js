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
const { simulateAlternative, compareDecisions, formatSimulationResult } = require('../dist/analysis/decisionDiff');
const { OllamaAdapter, createCodeLlamaAdapter, createDeepSeekCoderAdapter, createQwenCoderAdapter, detectBestCodeModel } = require('../dist/adapters/ollamaAdapter');
const { DogfoodingLoop } = require('../dist/dogfood/loop');
const { SelfImprovementProposer } = require('../dist/selfbuild/proposer');
const { ConstrainedLLM } = require('../dist/llm/constrained');
const { analyzeTestQuality, extractExportsFromCode } = require('../dist/validation/testQualityAnalyzer');
const { createTextURCO, createURCO, textPhaseProcessor, urcoText } = require('../dist/core/urco');
const { createCollapseChain, createDefaultCritic, createDefaultVerifier, createDefaultExecutor, collapse } = require('../dist/core/collapseChain');
const { createProposalURCO, createProposalCollapseChain, proposalPhaseProcessor } = require('../dist/dogfood/processors');
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
  // Use PROPOSAL_ADMITTED (registered schema) with required snake_case fields
  await testLedger.append('PROPOSAL_ADMITTED', {
    proposal_id: 'test-prop-001',
    target_file: 'src/core/result.ts',
    issue_type: 'NO_ERROR_HANDLING',
    // Additional fields for EvidenceQuery testing
    targetFile: 'src/core/result.ts',
    decisionType: 'reversible',
    severity: 'high',
    source: 'llm',
    rationale: 'Adding Result type'
  });
  await testLedger.append('PROPOSAL_ADMITTED', {
    proposal_id: 'test-prop-002',
    target_file: 'src/validation/sixGates.ts',
    issue_type: 'HIGH_COMPLEXITY',
    // Additional fields for EvidenceQuery testing
    targetFile: 'src/validation/sixGates.ts',
    decisionType: 'irreversible',
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
  console.log('=== DECISION DIFF TESTS ===');
  console.log('');

  // Create mock entry for testing
  const mockEntry = {
    id: 'test-diff-001',
    timestamp: Date.now(),
    type: 'PROPOSAL',
    hash: 'abc123',
    data: {
      proposalId: 'prop-001',
      targetFile: 'src/example/file.ts',
      decisionType: 'irreversible',
      issueType: 'NO_ERROR_HANDLING',
      severity: 'high',
      enables: ['Better error handling', 'Safer code'],
      forbids: ['Old API compatibility'],
      assumptions: ['Error handling needed']
    }
  };

  const simResult = simulateAlternative(mockEntry, 'Defer the decision');
  check('Diff: simulateAlternative works', simResult.ok);

  if (simResult.ok) {
    check('Diff: has consequence diff', simResult.value.diff !== undefined);
    check('Diff: has impact assessment', simResult.value.impact !== undefined);
    check('Diff: has divergence point', simResult.value.divergencePoint !== undefined);
  }

  // Compare two entries
  const mockEntry2 = {
    ...mockEntry,
    id: 'test-diff-002',
    data: {
      ...mockEntry.data,
      enables: ['Different feature', 'Another benefit'],
      forbids: ['Something else']
    }
  };

  const compareResult = compareDecisions(mockEntry, mockEntry2);
  check('Diff: compareDecisions works', compareResult.ok);
  if (compareResult.ok) {
    check('Diff: has unique enables', Array.isArray(compareResult.value.uniqueEnables));
    check('Diff: has alternative enables', Array.isArray(compareResult.value.alternativeEnables));
  }

  // Format output
  if (simResult.ok) {
    const formatted = formatSimulationResult(simResult.value);
    check('Diff: format includes sections',
          formatted.includes('DECISION SIMULATION') && formatted.includes('IMPACT ASSESSMENT'));
  }

  // ═══════════════════════════════════════════════════════════
  console.log('');
  console.log('=== OLLAMA ADAPTER TESTS ===');
  console.log('');

  // Test adapter creation with defaults
  const ollamaDefault = new OllamaAdapter();
  check('Ollama: default model is codellama:13b', ollamaDefault.getModel() === 'codellama:13b');
  check('Ollama: default URL is localhost:11434', ollamaDefault.getBaseUrl() === 'http://localhost:11434');

  // Test custom config
  const ollamaCustom = new OllamaAdapter({
    model: 'qwen2.5-coder:14b',
    baseUrl: 'http://192.168.1.100:11434'
  });
  check('Ollama: custom model is set', ollamaCustom.getModel() === 'qwen2.5-coder:14b');
  check('Ollama: custom URL is set', ollamaCustom.getBaseUrl() === 'http://192.168.1.100:11434');

  // Test model setter
  ollamaDefault.setModel('deepseek-coder:6.7b');
  check('Ollama: model can be changed', ollamaDefault.getModel() === 'deepseek-coder:6.7b');

  // Test factory functions
  const codellama7b = createCodeLlamaAdapter('7b');
  check('Ollama: CodeLlama 7b factory works', codellama7b.getModel() === 'codellama:7b');

  const codellama13b = createCodeLlamaAdapter('13b');
  check('Ollama: CodeLlama 13b factory works', codellama13b.getModel() === 'codellama:13b');

  const codellama34b = createCodeLlamaAdapter('34b');
  check('Ollama: CodeLlama 34b factory works', codellama34b.getModel() === 'codellama:34b');

  const deepseek13b = createDeepSeekCoderAdapter('1.3b');
  check('Ollama: DeepSeek 1.3b factory works', deepseek13b.getModel() === 'deepseek-coder:1.3b');

  const deepseek6b = createDeepSeekCoderAdapter('6.7b');
  check('Ollama: DeepSeek 6.7b factory works', deepseek6b.getModel() === 'deepseek-coder:6.7b');

  const qwen7b = createQwenCoderAdapter('7b');
  check('Ollama: Qwen 7b factory works', qwen7b.getModel() === 'qwen2.5-coder:7b');

  const qwen14b = createQwenCoderAdapter('14b');
  check('Ollama: Qwen 14b factory works', qwen14b.getModel() === 'qwen2.5-coder:14b');

  const qwen32b = createQwenCoderAdapter('32b');
  check('Ollama: Qwen 32b factory works', qwen32b.getModel() === 'qwen2.5-coder:32b');

  // Test LLMProvider interface compliance
  const testAdapter = new OllamaAdapter();
  check('Ollama: has generateCode method', typeof testAdapter.generateCode === 'function');
  check('Ollama: has generate method', typeof testAdapter.generate === 'function');
  check('Ollama: has decompose method', typeof testAdapter.decompose === 'function');
  check('Ollama: has isAvailable method', typeof testAdapter.isAvailable === 'function');
  check('Ollama: has listModels method', typeof testAdapter.listModels === 'function');
  check('Ollama: has hasModel method', typeof testAdapter.hasModel === 'function');

  // Test isAvailable returns Result (should return ok even if Ollama not running)
  const availResult = await testAdapter.isAvailable();
  check('Ollama: isAvailable returns Result', 'ok' in availResult);

  // Test factory defaults
  const defaultCodellama = createCodeLlamaAdapter();
  check('Ollama: CodeLlama default is 13b', defaultCodellama.getModel() === 'codellama:13b');

  const defaultDeepseek = createDeepSeekCoderAdapter();
  check('Ollama: DeepSeek default is 6.7b', defaultDeepseek.getModel() === 'deepseek-coder:6.7b');

  const defaultQwen = createQwenCoderAdapter();
  check('Ollama: Qwen default is 7b', defaultQwen.getModel() === 'qwen2.5-coder:7b');

  // Test that adapter is instance of OllamaAdapter
  check('Ollama: factory returns OllamaAdapter', defaultCodellama instanceof OllamaAdapter);

  // ═══════════════════════════════════════════════════════════
  console.log('');
  console.log('=== TEST QUALITY ANALYZER TESTS ===');
  console.log('');

  // Test 1: High quality test code
  const highQualityTest = `
import { decomposeTask } from '../src/decompose'

async function runTests() {
  const result = await decomposeTask('Main\\nSub1\\nSub2', 'task-1', ledger, config)

  assert(result.id === 'task-1', 'Task ID matches')
  assert(result.subtasks.length === 2, 'Correct subtask count')
  assert(result.subtasks[0].input === 'Sub1', 'First subtask correct')

  // Edge cases
  const empty = await decomposeTask('', 'empty', ledger, config)
  assert(empty.subtasks.length === 0, 'Empty input = no subtasks')
  assert(empty.status === 'done', 'Empty task marked done')

  try {
    await decomposeTask(null, 'null', ledger, config)
    assert(false, 'Should throw on null')
  } catch (e) {
    assert(true, 'Throws on null input')
  }
}

runTests().catch(console.error)
`;
  const tq1 = analyzeTestQuality(highQualityTest, ['decomposeTask']);
  check('TestQuality: high quality test scores well', tq1.ok && tq1.value.score >= 60);
  check('TestQuality: detects edge cases', tq1.ok && tq1.value.metrics.edgeCases.score >= 50);

  // Test 2: Trivial assertions
  const trivialTest = `
function runTests() {
  assert(true, 'test passed')
  assert(true, 'another pass')
  check('works', true)
}
runTests()
`;
  const tq2 = analyzeTestQuality(trivialTest, []);
  check('TestQuality: trivial assertions detected', tq2.ok && tq2.value.metrics.assertions.trivial >= 2);
  check('TestQuality: trivial test generates issues', tq2.ok && tq2.value.issues.some(i => i.includes('trivial')));

  // Test 3: Mock-heavy test
  const mockHeavyTest = `
class MockLLM { decompose() { return Ok(['a']) } }
class MockLedger { append() {} query() { return [] } }
class MockConfig {}

const mock = new MockLLM()
const ledger = new MockLedger()
assert(mock !== null, 'mock exists')
`;
  const tq3 = analyzeTestQuality(mockHeavyTest, []);
  check('TestQuality: mock classes detected', tq3.ok && tq3.value.metrics.mocks.mockClasses.length >= 2);
  check('TestQuality: high mock bias detected', tq3.ok && tq3.value.metrics.mocks.mockBiasRatio > 0.5);

  // Test 4: Coverage proxy - tests that call target functions
  const goodCoverageTest = `
import { validateInput, processData, saveResult } from '../src/processor'

async function test() {
  const v = validateInput('test')
  assert(v.ok, 'validates')

  const p = await processData(v.value)
  assert(p.length > 0, 'processes')

  const s = await saveResult(p)
  assert(s.saved, 'saves')
}
test()
`;
  const tq4 = analyzeTestQuality(goodCoverageTest, ['validateInput', 'processData', 'saveResult']);
  check('TestQuality: coverage proxy detects called functions', tq4.ok && tq4.value.metrics.coverage.targetFunctionsCovered === 3);
  check('TestQuality: full coverage = high score', tq4.ok && tq4.value.metrics.coverage.coverageProxy === 1.0);

  // Test 5: Low coverage - missing target functions
  const lowCoverageTest = `
import { validateInput } from '../src/processor'

async function test() {
  const v = validateInput('test')
  assert(v.ok, 'validates')
}
test()
`;
  const tq5 = analyzeTestQuality(lowCoverageTest, ['validateInput', 'processData', 'saveResult']);
  check('TestQuality: detects missing coverage', tq5.ok && tq5.value.metrics.coverage.targetFunctionsCovered === 1);
  check('TestQuality: low coverage generates issue', tq5.ok && tq5.value.issues.some(i => i.includes('coverage')));

  // Test 6: Extract exports helper
  const sourceCode = `
export function processData(input: string): Result<Data, Error> {
  return Ok({ input })
}

export const CONFIG = { timeout: 5000 }

export class DataProcessor {
  process() {}
}

function privateHelper() {}
`;
  const exports = extractExportsFromCode(sourceCode);
  check('TestQuality: extracts exported functions', exports.includes('processData'));
  check('TestQuality: extracts exported consts', exports.includes('CONFIG'));
  check('TestQuality: extracts exported classes', exports.includes('DataProcessor'));
  check('TestQuality: ignores private functions', !exports.includes('privateHelper'));

  // Test 7: Edge case detection patterns
  const edgeCaseTest = `
function test() {
  // Null check
  const nullResult = process(null)
  assert(nullResult === undefined, 'handles null')

  // Empty check
  const emptyResult = process('')
  assert(emptyResult.length === 0, 'handles empty')

  // Error path
  try {
    process(-1)
  } catch (e) {
    assert(e.message.includes('negative'), 'throws on negative')
  }
}
test()
`;
  const tq7 = analyzeTestQuality(edgeCaseTest, []);
  check('TestQuality: detects null check', tq7.ok && tq7.value.metrics.edgeCases.hasNullCheck);
  check('TestQuality: detects empty check', tq7.ok && tq7.value.metrics.edgeCases.hasEmptyCheck);
  check('TestQuality: detects error path', tq7.ok && tq7.value.metrics.edgeCases.hasErrorPath);

  // ═══════════════════════════════════════════════════════════
  console.log('');
  console.log('=== SELF-IMPROVEMENT LOOP TESTS ===');
  console.log('');

  // Create temp directory for test ledger
  const selfImproveTempDir = path.join(os.tmpdir(), `self-improve-${randomBytes(4).toString('hex')}`);
  fs.mkdirSync(selfImproveTempDir, { recursive: true });
  const selfImproveLedgerPath = path.join(selfImproveTempDir, 'test-ledger.jsonl');

  // Test DogfoodingLoop creation without LLM
  const noLlmLoop = new DogfoodingLoop({
    cycleInterval: 1000,
    requireHumanApproval: true,
    maxImprovementsPerCycle: 1,
    ledgerPath: selfImproveLedgerPath
  });
  check('Self-Improve: loop creates without LLM', noLlmLoop !== null);

  // Test DogfoodingLoop with Ollama config
  const ollamaLoop = new DogfoodingLoop({
    cycleInterval: 1000,
    requireHumanApproval: true,
    maxImprovementsPerCycle: 1,
    ledgerPath: selfImproveLedgerPath,
    ollamaEnabled: true,
    ollamaConfig: { model: 'codellama:13b' }
  });
  check('Self-Improve: loop creates with Ollama config', ollamaLoop !== null);

  // Test runOnce returns result structure
  const runResult = await noLlmLoop.runOnce();
  check('Self-Improve: runOnce returns success boolean', typeof runResult.success === 'boolean');
  // Without LLM, should fail with AXIOM 5 refusal or no issues
  check('Self-Improve: fails without LLM (AXIOM 5)', !runResult.success);

  // Test SelfImprovementProposer creation
  const proposer = new SelfImprovementProposer();
  check('Self-Improve: proposer creates without LLM', proposer !== null);

  // Test proposer refuses without LLM
  // Note: cli.ts is excluded (entry point), so use evidence.ts which has NO_TESTS issue
  const proposeResult = await proposer.proposeImprovement('src/evidence.ts');
  check('Self-Improve: proposer refuses without LLM (AXIOM 5)', !proposeResult.ok);
  if (!proposeResult.ok) {
    check('Self-Improve: error mentions AXIOM 5',
          proposeResult.error.message.includes('AXIOM 5'));
  }

  // Test ConstrainedLLM wraps Ollama
  const testOllamaAdapter = new OllamaAdapter();
  const constrainedLlm = new ConstrainedLLM(testOllamaAdapter, path.join(selfImproveTempDir, 'constrained.jsonl'));
  check('Self-Improve: ConstrainedLLM wraps Ollama', constrainedLlm !== null);

  // Test loop stop method exists
  check('Self-Improve: loop has stop method', typeof noLlmLoop.stop === 'function');

  // Cleanup
  fs.rmSync(selfImproveTempDir, { recursive: true, force: true });

  // ═══════════════════════════════════════════════════════════
  console.log('');
  console.log('=== URCO ENGINE TESTS ===');
  console.log('');

  // Test 1: Create text URCO engine
  const textUrco = createTextURCO();
  check('URCO: createTextURCO works', textUrco !== null);

  // Test 2: Process text through URCO
  const urcoTextResult = await urcoText('This is a test   with extra   spaces.', {});
  check('URCO: urcoText processes text', urcoTextResult.ok);
  check('URCO: reduces entropy', urcoTextResult.ok && urcoTextResult.value.entropyReduction >= 0);

  // Test 3: URCO has all four phases
  if (urcoTextResult.ok) {
    const phases = urcoTextResult.value.phases;
    check('URCO: has expand phase', phases.expand !== undefined);
    check('URCO: has examine phase', phases.examine !== undefined);
    check('URCO: has remove phase', phases.remove !== undefined);
    check('URCO: has synthesize phase', phases.synthesize !== undefined);
  }

  // Test 4: Phase artifacts are generated
  if (urcoTextResult.ok) {
    check('URCO: generates artifacts', urcoTextResult.value.artifacts.length > 0);
    check('URCO: artifacts have observations',
          urcoTextResult.value.artifacts.every(a => a.observation && a.observation.length > 0));
  }

  // Test 5: Entropy tracking
  if (urcoTextResult.ok) {
    check('URCO: tracks initial entropy', typeof urcoTextResult.value.initialEntropy === 'number');
    check('URCO: tracks final entropy', typeof urcoTextResult.value.finalEntropy === 'number');
    check('URCO: entropy is between 0 and 1',
          urcoTextResult.value.finalEntropy >= 0 && urcoTextResult.value.finalEntropy <= 1);
  }

  // Test 6: Custom phase processor
  const customProcessor = {
    expand: async (input, ctx) => ({ output: input.toUpperCase(), entropy: 0.5, artifacts: [], metadata: {} }),
    examine: async (input, ctx) => ({ output: input, entropy: 0.4, artifacts: [], metadata: {} }),
    remove: async (input, ctx) => ({ output: input.trim(), entropy: 0.3, artifacts: [], metadata: {} }),
    synthesize: async (input, ctx) => ({ output: input, entropy: 0.1, artifacts: [], metadata: {} })
  };
  const customUrco = createURCO(customProcessor);
  const customResult = await customUrco.process({ subject: 'test', context: {} });
  check('URCO: custom processor works', customResult.ok && customResult.value.output === 'TEST');

  // Test 7: Text phase processor cleans whitespace
  const dirtyText = '  hello   world  ';
  const urcoCleanResult = await textPhaseProcessor.remove(dirtyText, {});
  check('URCO: text processor removes extra whitespace', urcoCleanResult.output === 'hello world');

  // ═══════════════════════════════════════════════════════════
  console.log('');
  console.log('=== COLLAPSE CHAIN TESTS ===');
  console.log('');

  // Test 1: Default roles work
  const defaultCritic = createDefaultCritic();
  const defaultVerifier = createDefaultVerifier();
  const defaultExecutor = createDefaultExecutor();
  check('CollapseChain: default critic created', defaultCritic !== null);
  check('CollapseChain: default verifier created', defaultVerifier !== null);
  check('CollapseChain: default executor created', defaultExecutor !== null);

  // Test 2: Create collapse chain
  const ccChain = createCollapseChain(defaultCritic, defaultVerifier, defaultExecutor);
  check('CollapseChain: chain created', ccChain !== null);

  // Test 3: Collapse with valid input
  const validInput = { value: 42, validated: true };
  const collapseResult = await ccChain.collapse(validInput, {});
  check('CollapseChain: collapse returns result', collapseResult.ok);

  // Test 4: Chain has critique result
  if (collapseResult.ok) {
    check('CollapseChain: has critique', collapseResult.value.critique !== null);
    check('CollapseChain: critique has weaknesses array',
          Array.isArray(collapseResult.value.critique.weaknesses));
    check('CollapseChain: critique has counts',
          typeof collapseResult.value.critique.fatalCount === 'number');
  }

  // Test 5: Chain has verification result when critic approves
  if (collapseResult.ok && collapseResult.value.critique.approved) {
    check('CollapseChain: has verification when critic approves',
          collapseResult.value.verification !== null);
  }

  // Test 6: Chain has final state
  if (collapseResult.ok) {
    check('CollapseChain: has finalState',
          ['rejected_by_critic', 'rejected_by_verifier', 'execution_failed', 'collapsed']
            .includes(collapseResult.value.finalState));
  }

  // Test 7: Chain tracks duration
  if (collapseResult.ok) {
    check('CollapseChain: tracks total duration', collapseResult.value.totalDurationMs >= 0);
    check('CollapseChain: has timestamp', collapseResult.value.timestamp > 0);
  }

  // Test 8: Quick collapse function
  const quickResult = await collapse(validInput, {});
  check('CollapseChain: quick collapse works', quickResult.ok);

  // ═══════════════════════════════════════════════════════════
  console.log('');
  console.log('=== PROPOSAL PROCESSORS TESTS ===');
  console.log('');

  // Mock proposal for testing
  const urcoMockProposal = {
    id: 'test-proposal-123',
    targetFile: 'src/test/example.ts',
    issue: {
      type: 'MISSING_ERROR_HANDLING',
      severity: 'medium',
      message: 'Function lacks try-catch',
      line: 10
    },
    proposedChange: {
      type: 'modify_function',
      code: 'function test() { try { doSomething(); } catch (e) { console.error(e); } }'
    },
    rationale: 'Adding error handling',
    timestamp: Date.now(),
    gateValidation: {
      valid: true,
      gateResults: [
        { gateName: 'Gate 1', passed: true },
        { gateName: 'Gate 2', passed: true },
        { gateName: 'Gate 3', passed: true },
        { gateName: 'Gate 4', passed: true },
        { gateName: 'Gate 5', passed: true },
        { gateName: 'Gate 6', passed: true }
      ]
    },
    source: 'llm'
  };

  // Test 1: Proposal URCO processor
  const proposalUrco = createProposalURCO();
  check('Processors: proposal URCO created', proposalUrco !== null);

  // Test 2: Process proposal through URCO
  const proposalUrcoResult = await proposalUrco.process({
    subject: { proposal: urcoMockProposal },
    context: {}
  });
  check('Processors: proposal URCO processes', proposalUrcoResult.ok);

  // Test 3: URCO expand detects non-TCB
  if (proposalUrcoResult.ok) {
    const expandArtifacts = proposalUrcoResult.value.phases.expand.artifacts;
    check('Processors: URCO expand detects non-TCB target',
          expandArtifacts.some(a => a.observation.includes('non-TCB')));
  }

  // Test 4: URCO synthesize indicates readiness
  if (proposalUrcoResult.ok) {
    const isReady = proposalUrcoResult.value.phases.synthesize.metadata.isReady;
    check('Processors: URCO synthesize indicates ready', isReady === true);
  }

  // Test 5: Proposal Collapse Chain
  const proposalChain = createProposalCollapseChain();
  check('Processors: proposal collapse chain created', proposalChain !== null);

  // Test 6: Valid proposal passes critic
  const proposalCollapseResult = await proposalChain.collapse(
    { proposal: urcoMockProposal },
    { proposal: urcoMockProposal, dryRun: true }
  );
  check('Processors: valid proposal passes critic',
        proposalCollapseResult.ok && proposalCollapseResult.value.critique.approved);

  // Test 7: TCB file rejected by critic
  const urcoTcbProposal = { ...urcoMockProposal, targetFile: 'src/validation/sixGates.ts' };
  const tcbResult = await proposalChain.collapse(
    { proposal: urcoTcbProposal },
    { proposal: urcoTcbProposal, dryRun: true }
  );
  check('Processors: TCB file rejected by critic',
        tcbResult.ok && !tcbResult.value.critique.approved);
  check('Processors: TCB rejection is fatal',
        tcbResult.ok && tcbResult.value.critique.fatalCount > 0);

  // Test 8: Failed gates rejected by critic
  const failedGatesProposal = {
    ...urcoMockProposal,
    gateValidation: {
      valid: false,
      gateResults: [
        { gateName: 'Gate 1', passed: true },
        { gateName: 'Gate 2', passed: false, error: 'Syntax error' }
      ]
    }
  };
  const failedGatesResult = await proposalChain.collapse(
    { proposal: failedGatesProposal },
    { proposal: failedGatesProposal, dryRun: true }
  );
  check('Processors: failed gates rejected by critic',
        failedGatesResult.ok && !failedGatesResult.value.critique.approved);

  // Test 9: Dry run executor works
  if (proposalCollapseResult.ok && proposalCollapseResult.value.execution) {
    check('Processors: dry run executor executed',
          proposalCollapseResult.value.execution.executed);
    check('Processors: dry run action is dry_run',
          proposalCollapseResult.value.execution.action === 'dry_run');
  }

  // Test 10: Verifier checks URCO provenance
  const urcoProvResult = await proposalChain.collapse(
    { proposal: urcoMockProposal },
    { proposal: urcoMockProposal, dryRun: true, urcoResult: proposalUrcoResult.value }
  );
  if (urcoProvResult.ok && urcoProvResult.value.verification) {
    const urcoCheck = urcoProvResult.value.verification.checks.find(c => c.name === 'urco_provenance');
    check('Processors: verifier checks URCO provenance', urcoCheck && urcoCheck.passed);
  }

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
