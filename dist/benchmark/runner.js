"use strict";
// Benchmark Runner - Real metrics, no simulation
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LANES = void 0;
exports.runBenchmark = runBenchmark;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const tasks_1 = require("./tasks");
const contradictions_1 = require("../urco/contradictions");
const decompose_1 = require("../decompose");
const evidence_1 = require("../evidence");
const llm_1 = require("../llm");
const fs = __importStar(require("fs"));
exports.LANES = [
    {
        id: 'lane-a',
        name: 'Raw Claude Sonnet 4.5',
        model: 'claude-sonnet-4-5-20250929',
        useMotherlabs: false,
        description: 'Direct Claude API call with simple prompt'
    },
    {
        id: 'lane-b',
        name: 'Motherlabs + Sonnet 4.5',
        model: 'claude-sonnet-4-5-20250929',
        useMotherlabs: true,
        description: 'Motherlabs reasoning engine using same model'
    },
    {
        id: 'lane-c',
        name: 'Raw Claude Opus 4.5',
        model: 'claude-opus-4-5-20251101',
        useMotherlabs: false,
        description: 'Best available model as baseline'
    }
];
/**
 * Run task in Lane A or C (raw model, no Motherlabs)
 */
async function runRawLane(task, lane, client) {
    const startTime = Date.now();
    const message = await client.messages.create({
        model: lane.model,
        max_tokens: 4096,
        temperature: 0.3,
        messages: [{
                role: 'user',
                content: `Task: ${task.input}

Break this down into specific, actionable subtasks. Return ONLY a JSON array of strings:
["subtask 1", "subtask 2", ...]

No explanations. Just the JSON array.`
            }]
    });
    const endTime = Date.now();
    const rawOutput = message.content[0].type === 'text' ? message.content[0].text : '';
    // Try to parse JSON
    let parsedOutput;
    let validJson = false;
    try {
        const match = rawOutput.match(/\[[\s\S]*\]/);
        if (match) {
            parsedOutput = JSON.parse(match[0]);
            validJson = Array.isArray(parsedOutput);
        }
    }
    catch {
        validJson = false;
    }
    // Compute metrics
    const metrics = computeMetrics(task, rawOutput, parsedOutput, validJson);
    return {
        taskId: task.id,
        laneId: lane.id,
        timestamp: new Date().toISOString(),
        rawOutput,
        outputTokens: rawOutput.length,
        parsedOutput,
        metrics: {
            ...metrics,
            executionTime: endTime - startTime
        },
        evidence: {
            validJson,
            schemaValid: validJson && Array.isArray(parsedOutput),
            inventedPaths: findInventedPaths(rawOutput),
            missingExpected: task.expectedArtifacts.filter(exp => !containsArtifact(rawOutput, exp)),
            contradictions: (0, contradictions_1.detectContradictions)(rawOutput).length
        }
    };
}
/**
 * Run task in Lane B (Motherlabs)
 */
async function runMotherlabsLane(task, lane, apiKey) {
    const startTime = Date.now();
    const ledger = new evidence_1.Ledger();
    const llm = new llm_1.LLMAdapter(apiKey);
    const config = {
        kernelPath: '/home/motherlabs/motherlabs-kernel',
        anthropicApiKey: apiKey,
        maxDepth: 3,
        maxSubtasks: 10
    };
    const result = await (0, decompose_1.decomposeTask)(task.input, task.id, ledger, config, llm);
    const endTime = Date.now();
    // Convert to JSON output
    const subtasks = result.subtasks.map(st => st.input);
    const rawOutput = JSON.stringify(subtasks, null, 2);
    // Compute metrics
    const metrics = computeMetrics(task, rawOutput, subtasks, true);
    return {
        taskId: task.id,
        laneId: lane.id,
        timestamp: new Date().toISOString(),
        rawOutput,
        outputTokens: rawOutput.length,
        parsedOutput: subtasks,
        metrics: {
            ...metrics,
            executionTime: endTime - startTime
        },
        evidence: {
            validJson: true,
            schemaValid: true,
            inventedPaths: findInventedPaths(rawOutput),
            missingExpected: task.expectedArtifacts.filter(exp => !containsArtifact(rawOutput, exp)),
            contradictions: (0, contradictions_1.detectContradictions)(rawOutput).length
        }
    };
}
/**
 * Compute quality metrics (real calculations)
 */
function computeMetrics(task, output, parsed, validJson) {
    // 1. Compliance Score [0,1]
    let compliance = 0;
    if (validJson)
        compliance += 0.5;
    if (Array.isArray(parsed) && parsed.length > 0)
        compliance += 0.3;
    if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string'))
        compliance += 0.2;
    // 2. Hallucination Rate [0,1]
    const inventedPaths = findInventedPaths(output);
    const hallucinationRate = Math.min(1, inventedPaths.length * 0.2);
    // 3. Entropy Reduction (input tokens / output tokens)
    const inputTokens = task.input.length;
    const outputTokens = output.length;
    const entropyReduction = outputTokens > 0 ? inputTokens / outputTokens : 0;
    return {
        complianceScore: compliance,
        hallucinationRate,
        entropyReduction
    };
}
/**
 * Find potentially invented file paths/imports
 */
function findInventedPaths(text) {
    const invented = [];
    // Look for file paths that look suspicious
    const pathPatterns = [
        /(?:src|lib|app|utils)\/[a-z0-9_\-\/\.]+\.(?:ts|js|json|tsx)/gi,
        /import\s+.*from\s+['"]([@a-z0-9_\-\/\.]+)['"]/gi,
        /require\(['"]([@a-z0-9_\-\/\.]+)['"]\)/gi
    ];
    for (const pattern of pathPatterns) {
        for (const match of text.matchAll(pattern)) {
            const path = match[1] || match[0];
            // Heuristic: if it mentions specific files without context, likely invented
            if (/\/(utils|helpers|config|constants|types)\.[jt]s/i.test(path)) {
                invented.push(path);
            }
        }
    }
    return [...new Set(invented)];
}
/**
 * Check if output contains expected artifact
 */
function containsArtifact(output, artifact) {
    const normalized = output.toLowerCase();
    const artifactLower = artifact.toLowerCase();
    // Check for artifact or related terms
    return normalized.includes(artifactLower) ||
        normalized.includes(artifact.replace(/ /g, '_')) ||
        normalized.includes(artifact.replace(/ /g, '-'));
}
/**
 * Run full benchmark suite
 */
async function runBenchmark(apiKey, tasks = tasks_1.WARMUP_TASKS, outputPath) {
    const client = new sdk_1.default({ apiKey });
    const results = [];
    console.log(`\n=== Running Benchmark: ${tasks.length} tasks × ${exports.LANES.length} lanes ===\n`);
    for (const task of tasks) {
        console.log(`\n📋 Task: ${task.name} (${task.difficulty})`);
        console.log(`   ${task.input.substring(0, 80)}...`);
        for (const lane of exports.LANES) {
            console.log(`\n  → ${lane.name}...`);
            try {
                let result;
                if (lane.useMotherlabs) {
                    result = await runMotherlabsLane(task, lane, apiKey);
                }
                else {
                    result = await runRawLane(task, lane, client);
                }
                results.push(result);
                console.log(`     ✓ Compliance: ${(result.metrics.complianceScore * 100).toFixed(0)}%`);
                console.log(`     ✓ Hallucinations: ${result.evidence.inventedPaths.length}`);
                console.log(`     ✓ Time: ${result.metrics.executionTime}ms`);
            }
            catch (error) {
                console.error(`     ✗ Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
    }
    // Compute summary statistics
    const summary = {};
    for (const lane of exports.LANES) {
        const laneResults = results.filter(r => r.laneId === lane.id);
        if (laneResults.length > 0) {
            summary[lane.id] = {
                avgCompliance: average(laneResults.map(r => r.metrics.complianceScore)),
                avgHallucination: average(laneResults.map(r => r.metrics.hallucinationRate)),
                avgEntropyReduction: average(laneResults.map(r => r.metrics.entropyReduction)),
                avgExecutionTime: average(laneResults.map(r => r.metrics.executionTime)),
                tasksFailed: laneResults.filter(r => r.metrics.complianceScore < 0.5).length,
                tasksSucceeded: laneResults.filter(r => r.metrics.complianceScore >= 0.5).length
            };
        }
    }
    // Determine winners
    const winner = {
        bestCompliance: findBest(summary, s => s.avgCompliance),
        bestAccuracy: findBest(summary, s => 1 - s.avgHallucination),
        bestClarity: findBest(summary, s => s.avgEntropyReduction),
        overall: findBest(summary, s => s.avgCompliance * 0.4 +
            (1 - s.avgHallucination) * 0.4 +
            s.avgEntropyReduction * 0.2)
    };
    const report = {
        timestamp: new Date().toISOString(),
        lanes: exports.LANES,
        tasks,
        results,
        summary,
        winner
    };
    // Save to file if requested
    if (outputPath) {
        fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
        console.log(`\n💾 Report saved to: ${outputPath}`);
    }
    return report;
}
function average(numbers) {
    if (numbers.length === 0)
        return 0;
    return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}
function findBest(summary, metric) {
    let best = '';
    let bestScore = -Infinity;
    for (const [laneId, stats] of Object.entries(summary)) {
        const score = metric(stats);
        if (score > bestScore) {
            bestScore = score;
            best = laneId;
        }
    }
    return best;
}
