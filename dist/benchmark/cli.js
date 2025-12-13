#!/usr/bin/env node
"use strict";
// Benchmark CLI - Run comparison tests
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const runner_1 = require("./runner");
const tasks_1 = require("./tasks");
const path = __importStar(require("path"));
async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.length === 0) {
        console.log('Motherlabs Benchmark Suite');
        console.log('');
        console.log('Usage:');
        console.log('  benchmark [options]');
        console.log('');
        console.log('Options:');
        console.log('  --warmup     Run 2 warmup tasks (faster)');
        console.log('  --full       Run all 10 expert tasks (slower)');
        console.log('  --output     Output path (default: ~/Desktop/motherlabs-benchmark.json)');
        console.log('');
        console.log('Environment:');
        console.log('  ANTHROPIC_API_KEY  Required');
        process.exit(0);
    }
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        console.error('Error: ANTHROPIC_API_KEY environment variable required');
        process.exit(1);
    }
    const useWarmup = args.includes('--warmup');
    const useFull = args.includes('--full');
    const tasks = useFull ? tasks_1.BENCHMARK_TASKS : tasks_1.WARMUP_TASKS;
    const outputIdx = args.indexOf('--output');
    const outputPath = outputIdx >= 0 && args[outputIdx + 1]
        ? args[outputIdx + 1]
        : path.join(process.env.HOME || '/home/motherlabs', 'Desktop', 'motherlabs-benchmark.json');
    console.log('Motherlabs Quality Assurance Benchmark');
    console.log('=====================================');
    console.log(`Tasks: ${tasks.length} (${useWarmup || !useFull ? 'warmup' : 'full suite'})`);
    console.log(`Lanes: 3 (Raw Sonnet 4.5, Motherlabs+Sonnet 4.5, Raw Opus 4.5)`);
    console.log(`Output: ${outputPath}`);
    console.log('');
    try {
        const report = await (0, runner_1.runBenchmark)(apiKey, tasks, outputPath);
        // Print summary
        console.log('\n\n=== BENCHMARK RESULTS ===\n');
        for (const [laneId, stats] of Object.entries(report.summary)) {
            const lane = runner_1.LANES.find(l => l.id === laneId);
            console.log(`${lane.name}:`);
            console.log(`  Compliance:  ${(stats.avgCompliance * 100).toFixed(1)}%`);
            console.log(`  Accuracy:    ${((1 - stats.avgHallucination) * 100).toFixed(1)}%`);
            console.log(`  Clarity:     ${stats.avgEntropyReduction.toFixed(2)}`);
            console.log(`  Succeeded:   ${stats.tasksSucceeded}/${tasks.length}`);
            console.log('');
        }
        console.log('Winners:');
        console.log(`  Best Compliance:  ${runner_1.LANES.find(l => l.id === report.winner.bestCompliance)?.name}`);
        console.log(`  Best Accuracy:    ${runner_1.LANES.find(l => l.id === report.winner.bestAccuracy)?.name}`);
        console.log(`  Best Clarity:     ${runner_1.LANES.find(l => l.id === report.winner.bestClarity)?.name}`);
        console.log(`  Overall Winner:   ${runner_1.LANES.find(l => l.id === report.winner.overall)?.name}`);
        console.log('');
        console.log(`✓ Full report saved to: ${outputPath}`);
    }
    catch (error) {
        console.error('Benchmark failed:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
main();
