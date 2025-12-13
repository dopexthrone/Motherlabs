"use strict";
// Code Analyzer - Read and analyze TypeScript source
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
exports.analyzeFile = analyzeFile;
exports.analyzeDirectory = analyzeDirectory;
const ts_morph_1 = require("ts-morph");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const result_1 = require("../core/result");
/**
 * Analyze a TypeScript file
 */
function analyzeFile(filepath) {
    try {
        const project = new ts_morph_1.Project({
            tsConfigFilePath: path.join(__dirname, '../../tsconfig.json')
        });
        const sourceFile = project.addSourceFileAtPath(filepath);
        if (!sourceFile) {
            return (0, result_1.Err)(new Error(`Could not load file: ${filepath}`));
        }
        const metrics = calculateMetrics(sourceFile);
        const issues = detectIssues(sourceFile, filepath);
        return (0, result_1.Ok)({
            filepath,
            timestamp: Date.now(), // DETERMINISM-EXEMPT: Analysis metadata
            metrics,
            issues
        });
    }
    catch (error) {
        return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
    }
}
/**
 * Calculate code metrics (deterministic)
 */
function calculateMetrics(sourceFile) {
    const functions = sourceFile.getFunctions();
    const classes = sourceFile.getClasses();
    const methods = classes.flatMap(c => c.getMethods());
    const allFunctions = [...functions, ...methods];
    // Cyclomatic complexity (simple calculation)
    let totalComplexity = 0;
    for (const func of allFunctions) {
        totalComplexity += calculateFunctionComplexity(func);
    }
    const avgComplexity = allFunctions.length > 0
        ? totalComplexity / allFunctions.length
        : 0;
    // Lines of code (excluding comments/blank)
    const text = sourceFile.getFullText();
    const lines = text.split('\n');
    const codeLines = lines.filter(line => {
        const trimmed = line.trim();
        return trimmed.length > 0 && !trimmed.startsWith('//');
    });
    // Test coverage (check if test file exists)
    const testCoverage = hasTestFile(sourceFile.getFilePath()) ? 1.0 : 0.0;
    return {
        complexity: avgComplexity,
        linesOfCode: codeLines.length,
        functions: allFunctions.length,
        testCoverage
    };
}
/**
 * Calculate cyclomatic complexity of a function
 */
function calculateFunctionComplexity(func) {
    let complexity = 1; // Base complexity
    // Count decision points
    const body = func.getBody();
    if (!body)
        return complexity;
    const bodyText = body.getText();
    // Simple heuristic: count if/for/while/case/&&/||/catch
    const decisionPatterns = [
        /\bif\s*\(/g,
        /\bfor\s*\(/g,
        /\bwhile\s*\(/g,
        /\bcase\s+/g,
        /&&/g,
        /\|\|/g,
        /\bcatch\s*\(/g
    ];
    for (const pattern of decisionPatterns) {
        const matches = bodyText.match(pattern);
        if (matches) {
            complexity += matches.length;
        }
    }
    return complexity;
}
/**
 * Check if test file exists for source file
 */
function hasTestFile(filepath) {
    const basename = path.basename(filepath, '.ts');
    const dirname = path.dirname(filepath);
    const possibleTestPaths = [
        path.join(dirname, `${basename}.test.ts`),
        path.join(dirname, `__tests__/${basename}.test.ts`),
        path.join('tests', `${basename}.test.ts`)
    ];
    return possibleTestPaths.some(p => fs.existsSync(p));
}
/**
 * Detect issues in source file (deterministic)
 */
function detectIssues(sourceFile, filepath) {
    const issues = [];
    // Issue 1: No test file
    if (!hasTestFile(filepath)) {
        issues.push({
            type: 'NO_TESTS',
            severity: 'high',
            line: 1,
            message: `No test file found for ${path.basename(filepath)}`,
            fixable: true
        });
    }
    // Issue 2: High complexity functions
    const functions = sourceFile.getFunctions();
    const methods = sourceFile.getClasses().flatMap(c => c.getMethods());
    for (const func of [...functions, ...methods]) {
        const complexity = calculateFunctionComplexity(func);
        if (complexity > 10) {
            const line = func.getStartLineNumber();
            issues.push({
                type: 'HIGH_COMPLEXITY',
                severity: complexity > 20 ? 'high' : 'medium',
                line,
                message: `Function "${func.getName() || 'anonymous'}" has complexity ${complexity} (>10)`,
                fixable: true
            });
        }
    }
    // Issue 3: No error handling (try/catch or Result)
    for (const func of [...functions, ...methods]) {
        const body = func.getBody();
        if (!body)
            continue;
        const bodyText = body.getText();
        const hasAsync = func.isAsync();
        const hasErrorHandling = /try\s*\{|Result<|\.catch\(/.test(bodyText);
        if (hasAsync && !hasErrorHandling) {
            issues.push({
                type: 'NO_ERROR_HANDLING',
                severity: 'medium',
                line: func.getStartLineNumber(),
                message: `Async function "${func.getName()}" lacks error handling`,
                fixable: true
            });
        }
    }
    return issues;
}
/**
 * Analyze entire directory
 */
function analyzeDirectory(dirPath) {
    try {
        const files = fs.readdirSync(dirPath, { recursive: true, withFileTypes: true })
            .filter(f => f.isFile() && f.name.endsWith('.ts') && !f.name.endsWith('.test.ts'))
            .map(f => path.join(dirPath, f.name));
        const analyses = [];
        for (const file of files) {
            const result = analyzeFile(file);
            if (result.ok) {
                analyses.push(result.value);
            }
        }
        return (0, result_1.Ok)(analyses);
    }
    catch (error) {
        return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
    }
}
