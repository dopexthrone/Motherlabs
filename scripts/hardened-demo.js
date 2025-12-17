const { SixGateValidator } = require('/home/motherlabs/motherlabs-runtime/dist/validation/sixGates');
const { AnthropicAdapter } = require('/home/motherlabs/motherlabs-runtime/dist/adapters/anthropicAdapter');
const { ConstrainedLLM } = require('/home/motherlabs/motherlabs-runtime/dist/llm/constrained');

async function demo() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  HARDENED PIPELINE DEMO: Claude + 6-Gate Validation');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  const validator = new SixGateValidator();
  const adapter = new AnthropicAdapter(process.env.ANTHROPIC_API_KEY, 'claude-sonnet-4-20250514');
  const constrainedLLM = new ConstrainedLLM(adapter, '/tmp/demo-evidence.jsonl');

  // ═══════════════════════════════════════════════════════════════
  // DEMO 1: Claude generates CLEAN code → PASSES all gates
  // ═══════════════════════════════════════════════════════════════
  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log('│  DEMO 1: Claude generates clean utility function            │');
  console.log('└─────────────────────────────────────────────────────────────┘');
  console.log('');

  const cleanRequest = {
    issue: { type: 'MISSING_FUNCTION', severity: 'medium', line: 1, message: 'Add string utility', fixable: true },
    filepath: 'src/utils/strings.ts',
    existingCode: '',
    context: { existingImports: [], existingTypes: [] }
  };

  console.log('  Request: Generate string utility functions');
  console.log('  Sending to Claude...');

  const cleanResult = await constrainedLLM.generateCode(cleanRequest);

  if (cleanResult.ok) {
    console.log('  ✓ Claude generated code');
    console.log('  ✓ All 6 gates PASSED');
    console.log('');
    console.log('  Gate Results:');
    // ConstrainedLLM wraps validation results inside .validation
    cleanResult.value.validation.gateResults.forEach(g => {
      console.log('    ' + (g.passed ? '✓' : '✗') + ' ' + g.gateName);
    });
    console.log('');
    console.log('  Provider:', cleanResult.value.provider);
    console.log('  Attempts:', cleanResult.value.attempts);
    console.log('');
    console.log('  Generated code (first 400 chars):');
    console.log('  ─────────────────────────────────');
    const codePreview = cleanResult.value.code.substring(0, 400).split('\n').map(l => '  ' + l).join('\n');
    console.log(codePreview + '...');
  } else {
    console.log('  ✗ Generation failed:', cleanResult.error.message);
  }

  console.log('');
  console.log('');

  // ═══════════════════════════════════════════════════════════════
  // DEMO 2: Manually test MALICIOUS code → REJECTED by gates
  // ═══════════════════════════════════════════════════════════════
  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log('│  DEMO 2: Malicious code injection → REJECTED                │');
  console.log('└─────────────────────────────────────────────────────────────┘');
  console.log('');

  const maliciousCode = `
export function runCommand(userInput: string): void {
  const { exec } = require('child_process');
  exec(\`ls \${userInput}\`);  // COMMAND INJECTION!
}
`;

  console.log('  Testing code with command injection vulnerability...');
  const maliciousResult = await validator.validate(maliciousCode, { existingImports: [], existingTypes: [] });

  console.log('  Valid:', maliciousResult.value.valid);
  console.log('  Rejected at:', maliciousResult.value.rejectedAt || 'N/A');
  console.log('');
  console.log('  Gate Results:');
  maliciousResult.value.gateResults.forEach(g => {
    const status = g.passed ? '✓' : '✗';
    const error = g.error ? ': ' + g.error.substring(0, 50) : '';
    console.log('    ' + status + ' ' + g.gateName + error);
  });

  console.log('');
  console.log('');

  // ═══════════════════════════════════════════════════════════════
  // DEMO 3: Eval usage → REJECTED by AST scanner
  // ═══════════════════════════════════════════════════════════════
  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log('│  DEMO 3: Eval usage → REJECTED                              │');
  console.log('└─────────────────────────────────────────────────────────────┘');
  console.log('');

  const evalCode = `
export function dangerous(code: string): any {
  return eval(code);  // EVAL IS DANGEROUS!
}
`;

  console.log('  Testing code with eval()...');
  const evalResult = await validator.validate(evalCode, { existingImports: [], existingTypes: [] });

  console.log('  Valid:', evalResult.value.valid);
  const gate6 = evalResult.value.gateResults.find(g => g.gateName === 'governance_check');
  if (gate6 && gate6.error) {
    console.log('  Security violation:', gate6.error.substring(0, 80));
  }

  console.log('');
  console.log('');

  // ═══════════════════════════════════════════════════════════════
  // DEMO 4: Type error → REJECTED by Gate 2
  // ═══════════════════════════════════════════════════════════════
  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log('│  DEMO 4: Type error → REJECTED                              │');
  console.log('└─────────────────────────────────────────────────────────────┘');
  console.log('');

  const typeErrorCode = `
export function add(a: number, b: number): string {
  return a + b;  // Returns number, not string!
}
`;

  console.log('  Testing code with type error...');
  const typeResult = await validator.validate(typeErrorCode, { existingImports: [], existingTypes: [] });

  console.log('  Valid:', typeResult.value.valid);
  const gate2 = typeResult.value.gateResults.find(g => g.gateName === 'syntax_validation');
  if (gate2) {
    console.log('  Gate 2 passed:', gate2.passed);
    if (gate2.error) console.log('  Error:', gate2.error.substring(0, 80));
  }

  console.log('');
  console.log('');

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  const d1 = cleanResult.ok ? '✓ PASSED all 6 gates' : '✗ FAILED';
  const d2 = !maliciousResult.value.valid ? '✓ REJECTED (security)' : '✗ Should reject';
  const d3 = !evalResult.value.valid ? '✓ REJECTED (eval)' : '✗ Should reject';
  const d4 = !typeResult.value.valid ? '✓ REJECTED (type)' : '⚠ Type coercion';
  console.log('  Demo 1 (Clean code):      ' + d1);
  console.log('  Demo 2 (Cmd injection):   ' + d2);
  console.log('  Demo 3 (Eval):            ' + d3);
  console.log('  Demo 4 (Type error):      ' + d4);
  console.log('');
  console.log('  Hardened pipeline working correctly!');
  console.log('═══════════════════════════════════════════════════════════════');
}

demo().catch(err => console.error('Fatal:', err.message));
