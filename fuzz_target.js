import { evalExpression } from './src/eval';
import * as fs from 'fs';

function fuzzTarget(inputPath: string): void {
  try {
    const input: string = fs.readFileSync(inputPath, 'utf-8');
    evalExpression(input);
  } catch (e: any) {
    // Ignore errors during fuzzing, as invalid inputs are expected.
    // You might want to log specific error types for analysis.
    // console.error(e);
  }
}

// AFL++ provides the input file path as a command-line argument.
if (process.argv.length > 2) {
  const inputPath: string = process.argv[2];
  fuzzTarget(inputPath);
} else {
  console.error('Usage: node fuzz_target.js <input_file>');
  process.exit(1);
}