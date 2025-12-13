#!/usr/bin/env node
"use strict";
// Trap Benchmark CLI - Test constraint system effectiveness
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
const trapRunner_1 = require("./trapRunner");
const path = __importStar(require("path"));
async function main() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        console.error('Error: ANTHROPIC_API_KEY environment variable required');
        process.exit(1);
    }
    const outputPath = path.join(process.env.HOME || '/home/motherlabs', 'Desktop', 'motherlabs-trap-benchmark.json');
    console.log('Motherlabs Trap Detection Benchmark');
    console.log('===================================');
    console.log('Testing 10 tasks with deliberate violations');
    console.log('Expected: Raw LLM proceeds, Motherlabs blocks');
    console.log('');
    try {
        const results = await (0, trapRunner_1.runTrapBenchmark)(apiKey);
        (0, trapRunner_1.generateTrapReport)(results, outputPath);
    }
    catch (error) {
        console.error('Trap benchmark failed:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
main();
