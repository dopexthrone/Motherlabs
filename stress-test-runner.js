const { DogfoodingLoop } = require('./dist/dogfood/loop');
const fs = require('fs');

const DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours
const CYCLE_MS = 60 * 1000; // 60 seconds between cycles
const START_TIME = Date.now();
const LOG_FILE = 'evidence/stress-test-log.txt';

function log(msg) {
  const elapsed = Math.floor((Date.now() - START_TIME) / 1000);
  const hrs = Math.floor(elapsed / 3600);
  const mins = Math.floor((elapsed % 3600) / 60);
  const secs = elapsed % 60;
  const timestamp = `[${hrs}h ${mins}m ${secs}s]`;
  const line = `${timestamp} ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

async function runStressTest() {
  fs.writeFileSync(LOG_FILE, `Stress test started at ${new Date().toISOString()}\n`);

  const loop = new DogfoodingLoop({
    cycleInterval: CYCLE_MS,
    requireHumanApproval: false,
    maxImprovementsPerCycle: 1,
    ledgerPath: 'evidence/stress-test.jsonl',
    ollamaEnabled: true,
    ollamaConfig: { model: 'llama3.1:8b-instruct-q4_K_M' }
  });

  let cycles = 0;
  let successes = 0;
  let refusals = 0;
  let errors = 0;

  log('Stress test started - 2 hour duration');

  while (Date.now() - START_TIME < DURATION_MS) {
    cycles++;

    try {
      const result = await loop.runOnce();

      if (result.success && result.proposal) {
        successes++;
        log(`OK Cycle ${cycles}: Improved ${result.proposal.targetFile}`);
      } else if (result.error && result.error.includes('AXIOM 5')) {
        refusals++;
        log(`REFUSED Cycle ${cycles}: Gates protected`);
      } else if (result.error && result.error.includes('No issues')) {
        log(`OPTIMAL Cycle ${cycles}: No issues found`);
      } else {
        errors++;
        log(`ERROR Cycle ${cycles}: ${(result.error || 'unknown').slice(0, 40)}`);
      }
    } catch (err) {
      errors++;
      log(`EXCEPTION Cycle ${cycles}: ${err.message.slice(0, 40)}`);
    }

    if (cycles % 10 === 0) {
      log(`--- Status: ${successes} improved, ${refusals} refused, ${errors} errors ---`);
    }

    await new Promise(r => setTimeout(r, CYCLE_MS));
  }

  log('');
  log('=== STRESS TEST COMPLETE ===');
  log(`Cycles: ${cycles}`);
  log(`Improved: ${successes}`);
  log(`Refused: ${refusals}`);
  log(`Errors: ${errors}`);
}

runStressTest().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
