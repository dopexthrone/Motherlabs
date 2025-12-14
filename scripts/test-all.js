#!/usr/bin/env node
// Motherlabs Runtime - Full Test Suite

const { scanForVulnerabilities } = require('../dist/validation/securityScanner');
const { checkAxiomViolations } = require('../dist/validation/axiomChecker');
const { SixGateValidator } = require('../dist/validation/sixGates');
const { runTestExec } = require('../dist/sandbox/runner');
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
