// Generate human-readable task review

const fs = require('fs')
const path = require('path')

const reportPath = path.join(process.env.HOME, 'Desktop', 'motherlabs-benchmark.json')
const outputDir = path.join(process.env.HOME, 'Desktop', 'benchmark-review')

if (!fs.existsSync(reportPath)) {
  console.error('Benchmark report not found. Run benchmark first.')
  process.exit(1)
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'))

// Create output directory
fs.mkdirSync(outputDir, { recursive: true })

// Generate index
let index = `# MOTHERLABS BENCHMARK REVIEW
**Date:** ${new Date(report.timestamp).toLocaleString()}
**Tasks:** ${report.tasks.length}
**Lanes:** ${report.lanes.length}

## Summary

| Lane | Compliance | Accuracy | Clarity | Avg Time | Success |
|------|------------|----------|---------|----------|---------|
`

for (const [laneId, stats] of Object.entries(report.summary)) {
  const lane = report.lanes.find(l => l.id === laneId)
  index += `| ${lane.name} | ${(stats.avgCompliance * 100).toFixed(0)}% | ${((1 - stats.avgHallucination) * 100).toFixed(0)}% | ${stats.avgEntropyReduction.toFixed(2)} | ${(stats.avgExecutionTime / 1000).toFixed(1)}s | ${stats.tasksSucceeded}/${report.tasks.length} |\n`
}

index += `\n## Tasks\n\n`

// Generate individual task files
for (const task of report.tasks) {
  const taskResults = report.results.filter(r => r.taskId === task.id)
  
  index += `- [${task.name}](./task-${task.id}.md) (${task.difficulty})\n`
  
  let taskDoc = `# ${task.name}

**Difficulty:** ${task.difficulty}
**Category:** ${task.category}

## Input Task

\`\`\`
${task.input}
\`\`\`

## Expected Artifacts

${task.expectedArtifacts.map(a => `- ${a}`).join('\n')}

---

`

  for (const result of taskResults) {
    const lane = report.lanes.find(l => l.id === result.laneId)
    
    taskDoc += `## ${lane.name}

**Metrics:**
- Compliance: ${(result.metrics.complianceScore * 100).toFixed(0)}%
- Hallucination Rate: ${(result.metrics.hallucinationRate * 100).toFixed(0)}%
- Clarity: ${result.metrics.entropyReduction.toFixed(3)}
- Execution Time: ${(result.metrics.executionTime / 1000).toFixed(1)}s

**Evidence:**
- Valid JSON: ${result.evidence.validJson ? '✓' : '✗'}
- Schema Valid: ${result.evidence.schemaValid ? '✓' : '✗'}
- Invented Paths: ${result.evidence.inventedPaths.length}
- Missing Expected: ${result.evidence.missingExpected.length}
- Contradictions: ${result.evidence.contradictions}

**Output:**

\`\`\`json
${result.rawOutput.substring(0, 2000)}${result.rawOutput.length > 2000 ? '\n...(truncated)' : ''}
\`\`\`

---

`
  }
  
  fs.writeFileSync(path.join(outputDir, `task-${task.id}.md`), taskDoc)
}

fs.writeFileSync(path.join(outputDir, 'INDEX.md'), index)

console.log(`✓ Review created at: ${outputDir}/INDEX.md`)
console.log(`✓ Generated ${report.tasks.length} task detail files`)
