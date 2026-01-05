#!/usr/bin/env node
/**
 * Verifier Report Ingestion Tool
 * ===============================
 *
 * Validates and ingests external verifier submissions.
 *
 * Usage:
 *   npm run ingest-verifier -- <version> <path>
 *
 * Example:
 *   npm run ingest-verifier -- v0.2.1 artifacts/verifier_reports/v0.2.1/incoming/20260105_acme/
 *
 * This tool:
 *   1. Validates required files exist
 *   2. Validates JSON against schema (if present)
 *   3. Parses metadata from markdown report
 *   4. Moves folder to verified/ or failed/
 *   5. Updates INDEX.md with new entry
 */

import { readFile, writeFile, mkdir, rename, access, readdir, stat } from 'node:fs/promises';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

// =============================================================================
// Constants
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// When compiled, this file is at dist/tools/ingest_verifier_report.js
// So we need to go up two levels to reach the project root
const PROJECT_ROOT = resolve(__dirname, '..', '..');

const ARTIFACTS_DIR = join(PROJECT_ROOT, 'artifacts');
const VERIFIER_REPORTS_BASE = join(ARTIFACTS_DIR, 'verifier_reports');
const INDEX_PATH = join(VERIFIER_REPORTS_BASE, 'INDEX.md');
const SCHEMA_PATH = join(PROJECT_ROOT, 'docs', 'verifier_report.schema.json');

// Required files in submission
const REQUIRED_FILES = ['VERIFIER_REPORT.md'];

// Folder name pattern: YYYYMMDD_verifier_id
const FOLDER_NAME_PATTERN = /^(\d{8})_([a-zA-Z0-9_-]+)$/;

// =============================================================================
// Types
// =============================================================================

interface ParsedMetadata {
  release_tag: string;
  verified: boolean;
  result: 'PASS' | 'FAIL' | 'PARTIAL';
  os: string;
  node_version: string;
  npm_version: string;
  verifier_handle: string;
  date: string;
}

interface VerifierReportJson {
  schema_version: string;
  release_version: string;
  verifier: { handle: string; date_utc: string };
  environment: { os: string; node_version: string; npm_version?: string };
  summary: { result: 'PASS' | 'FAIL' | 'PARTIAL' };
  [key: string]: unknown;
}

interface IndexEntry {
  date: string;
  verifier_id: string;
  release_tag: string;
  result: string;
  os: string;
  node: string;
  npm: string;
  path: string;
}

// =============================================================================
// Validation
// =============================================================================

function validateFolderName(folderName: string): { date: string; verifier_id: string } {
  const match = folderName.match(FOLDER_NAME_PATTERN);
  if (!match) {
    throw new Error(
      `Invalid folder name format: "${folderName}". ` +
        `Expected: YYYYMMDD_verifier_id (e.g., 20260105_acme)`
    );
  }

  const dateStr = match[1]!;
  // Validate date is valid
  const year = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(4, 6), 10);
  const day = parseInt(dateStr.slice(6, 8), 10);

  if (year < 2024 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Invalid date in folder name: "${dateStr}"`);
  }

  return { date: dateStr, verifier_id: match[2]! };
}

async function validateRequiredFiles(submissionPath: string): Promise<void> {
  for (const file of REQUIRED_FILES) {
    const filePath = join(submissionPath, file);
    try {
      await access(filePath);
    } catch {
      throw new Error(`Missing required file: ${file}`);
    }
  }
}

async function validateJsonSchema(
  jsonPath: string,
  schemaPath: string
): Promise<VerifierReportJson> {
  const jsonContent = await readFile(jsonPath, 'utf-8');
  let json: VerifierReportJson;

  try {
    json = JSON.parse(jsonContent) as VerifierReportJson;
  } catch (e) {
    throw new Error(`Invalid JSON in verifier_report.json: ${(e as Error).message}`);
  }

  // Load schema
  const schemaContent = await readFile(schemaPath, 'utf-8');
  const schema = JSON.parse(schemaContent);

  // Validate required fields from schema
  const required = schema.required as string[];
  const missing: string[] = [];

  for (const field of required) {
    if (!(field in json)) {
      missing.push(field);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `verifier_report.json missing required fields: ${missing.join(', ')}`
    );
  }

  // Validate schema_version
  if (json.schema_version !== '1.0') {
    throw new Error(
      `Invalid schema_version: "${json.schema_version}". Expected: "1.0"`
    );
  }

  // Validate release_version format
  if (!/^v\d+\.\d+\.\d+$/.test(json.release_version)) {
    throw new Error(
      `Invalid release_version format: "${json.release_version}". Expected: vX.Y.Z`
    );
  }

  // Validate summary.result
  if (!['PASS', 'FAIL', 'PARTIAL'].includes(json.summary.result)) {
    throw new Error(
      `Invalid summary.result: "${json.summary.result}". Expected: PASS, FAIL, or PARTIAL`
    );
  }

  // Validate nested required fields
  if (!json.verifier?.handle) {
    throw new Error('verifier_report.json missing verifier.handle');
  }
  if (!json.verifier?.date_utc) {
    throw new Error('verifier_report.json missing verifier.date_utc');
  }
  if (!json.environment?.os) {
    throw new Error('verifier_report.json missing environment.os');
  }
  if (!json.environment?.node_version) {
    throw new Error('verifier_report.json missing environment.node_version');
  }

  return json;
}

// =============================================================================
// Markdown Parsing
// =============================================================================

function parseMarkdownReport(content: string, expectedVersion: string): ParsedMetadata {
  const missing: string[] = [];

  // Parse release tag from title (e.g., "# Verifier Report: v0.2.1")
  const titleMatch = content.match(/^#\s*Verifier Report:\s*(v\d+\.\d+\.\d+)/m);
  const release_tag = titleMatch?.[1] ?? '';
  if (!release_tag) {
    missing.push('release_tag (from title "# Verifier Report: vX.Y.Z")');
  } else if (release_tag !== expectedVersion) {
    throw new Error(
      `Release version mismatch: report is for "${release_tag}" but expected "${expectedVersion}"`
    );
  }

  // Parse Overall Result: [PASS / FAIL / PARTIAL]
  const resultMatch = content.match(/###\s*Overall Result:\s*(PASS|FAIL|PARTIAL)/i);
  const resultStr = resultMatch?.[1]?.toUpperCase() ?? '';
  if (!resultStr) {
    missing.push('result (from "### Overall Result: PASS/FAIL/PARTIAL")');
  }
  const result = (resultStr || 'FAIL') as 'PASS' | 'FAIL' | 'PARTIAL';
  const verified = result === 'PASS';

  // Parse OS (e.g., "- **OS**: Ubuntu 22.04.3 LTS")
  const osMatch = content.match(/\*\*OS\*\*:\s*(.+?)(?:\n|$)/);
  const os = osMatch?.[1]?.trim().replace(/^\[|\]$/g, '') ?? '';
  if (!os || os.includes('[')) {
    missing.push('os (from "**OS**: ...")');
  }

  // Parse Node Version (e.g., "- **Node Version**: v24.11.1")
  const nodeMatch = content.match(/\*\*Node Version\*\*:\s*(.+?)(?:\n|$)/);
  const node_version = nodeMatch?.[1]?.trim().replace(/^\[.*\]$/, '') ?? '';
  if (!node_version || node_version.includes('[')) {
    missing.push('node_version (from "**Node Version**: ...")');
  }

  // Parse npm Version (e.g., "- **npm Version**: 10.x.x")
  const npmMatch = content.match(/\*\*npm Version\*\*:\s*(.+?)(?:\n|$)/);
  const npm_version = npmMatch?.[1]?.trim().replace(/^\[.*\]$/, '') ?? '';
  if (!npm_version || npm_version.includes('[')) {
    missing.push('npm_version (from "**npm Version**: ...")');
  }

  // Parse Verifier Handle (e.g., "- **Name/Handle**: acme")
  const handleMatch = content.match(/\*\*Name\/Handle\*\*:\s*(.+?)(?:\n|$)/);
  const verifier_handle = handleMatch?.[1]?.trim().replace(/^\[.*\]$/, '') ?? '';
  if (!verifier_handle || verifier_handle.includes('[')) {
    missing.push('verifier_handle (from "**Name/Handle**: ...")');
  }

  // Parse Date (e.g., "- **Date (UTC)**: 2026-01-05")
  const dateMatch = content.match(/\*\*Date \(UTC\)\*\*:\s*(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch?.[1] ?? '';
  if (!date) {
    missing.push('date (from "**Date (UTC)**: YYYY-MM-DD")');
  }

  if (missing.length > 0) {
    throw new Error(
      `VERIFIER_REPORT.md missing required fields:\n  - ${missing.join('\n  - ')}`
    );
  }

  return {
    release_tag,
    verified,
    result,
    os,
    node_version,
    npm_version,
    verifier_handle,
    date,
  };
}

// =============================================================================
// Index Management
// =============================================================================

function parseExistingEntries(indexContent: string, version: string): IndexEntry[] {
  const entries: IndexEntry[] = [];

  // Find the section for this version and look for table rows
  // Format: | 20260105 | acme | v0.2.1 | PASS | Ubuntu 22.04 | v24.11.1 | 10.2.0 | v0.2.1/verified/20260105_acme/ |
  const tableRowPattern =
    /^\|\s*(\d{8})\s*\|\s*([^\|]+)\s*\|\s*(v[\d.]+)\s*\|\s*(PASS|FAIL|PARTIAL)\s*\|\s*([^\|]+)\s*\|\s*([^\|]+)\s*\|\s*([^\|]+)\s*\|\s*([^\|]+)\s*\|/gm;

  let match;
  while ((match = tableRowPattern.exec(indexContent)) !== null) {
    if (match[3]?.trim() === version) {
      entries.push({
        date: match[1]!.trim(),
        verifier_id: match[2]!.trim(),
        release_tag: match[3]!.trim(),
        result: match[4]!.trim(),
        os: match[5]!.trim(),
        node: match[6]!.trim(),
        npm: match[7]!.trim(),
        path: match[8]!.trim(),
      });
    }
  }

  return entries;
}

function checkDuplicate(
  entries: IndexEntry[],
  date: string,
  verifier_id: string
): boolean {
  return entries.some((e) => e.date === date && e.verifier_id === verifier_id);
}

function formatTableRow(entry: IndexEntry): string {
  return `| ${entry.date} | ${entry.verifier_id} | ${entry.release_tag} | ${entry.result} | ${entry.os} | ${entry.node} | ${entry.npm} | ${entry.path} |`;
}

async function updateIndex(
  indexPath: string,
  version: string,
  entry: IndexEntry
): Promise<void> {
  let content = await readFile(indexPath, 'utf-8');

  // Find the section for this version
  const sectionRegex = new RegExp(`(###\\s*${version.replace(/\./g, '\\.')}[\\s\\S]*?)(?=###\\s*v\\d|##\\s*Verification Process|$)`);
  const sectionMatch = content.match(sectionRegex);

  if (!sectionMatch) {
    throw new Error(`Version section "${version}" not found in INDEX.md`);
  }

  const section = sectionMatch[1]!;

  // Check if table already exists
  const tableHeaderPattern = /\| Date \| Verifier \| Release \| Result \| OS \| Node \| npm \| Path \|/;
  const hasTable = tableHeaderPattern.test(section);

  let newSection: string;

  if (hasTable) {
    // Parse existing entries
    const existingEntries = parseExistingEntries(section, version);

    // Check for duplicate
    if (checkDuplicate(existingEntries, entry.date, entry.verifier_id)) {
      throw new Error(
        `Duplicate entry: ${entry.date}_${entry.verifier_id} already exists in INDEX.md`
      );
    }

    // Add new entry and sort by date desc, then verifier_id asc
    existingEntries.push(entry);
    existingEntries.sort((a, b) => {
      if (a.date !== b.date) {
        return b.date.localeCompare(a.date); // Descending by date
      }
      return a.verifier_id.localeCompare(b.verifier_id); // Ascending by verifier_id
    });

    // Find the table and replace it
    const tableStart = section.indexOf('| Date |');
    const tableEndMatch = section.slice(tableStart).match(/\n(?!\|)/);
    const tableEnd = tableEndMatch ? tableStart + tableEndMatch.index! : section.length;

    const tableHeader = `| Date | Verifier | Release | Result | OS | Node | npm | Path |
|------|----------|---------|--------|-----|------|-----|------|`;
    const tableRows = existingEntries.map(formatTableRow).join('\n');
    const newTable = `${tableHeader}\n${tableRows}`;

    newSection = section.slice(0, tableStart) + newTable + section.slice(tableEnd);
  } else {
    // Create new table after "**External verification reports:**"
    const insertPoint = section.indexOf('**External verification reports:**');
    if (insertPoint === -1) {
      throw new Error(`Cannot find "**External verification reports:**" in ${version} section`);
    }

    // Find the "- None yet" line to replace
    const noneYetMatch = section.slice(insertPoint).match(/- None yet\n?/);
    const noneYetPos = noneYetMatch ? insertPoint + noneYetMatch.index! : -1;

    const tableHeader = `| Date | Verifier | Release | Result | OS | Node | npm | Path |
|------|----------|---------|--------|-----|------|-----|------|`;
    const tableRow = formatTableRow(entry);
    const newTable = `${tableHeader}\n${tableRow}`;

    if (noneYetPos !== -1) {
      // Replace "- None yet" with the table
      newSection =
        section.slice(0, noneYetPos) +
        newTable +
        '\n' +
        section.slice(noneYetPos + (noneYetMatch?.[0]?.length ?? 0));
    } else {
      // Insert after "**External verification reports:**" line
      const lineEnd = section.indexOf('\n', insertPoint);
      newSection =
        section.slice(0, lineEnd + 1) + newTable + '\n' + section.slice(lineEnd + 1);
    }
  }

  // Update verifier count
  const countMatch = newSection.match(/Independent verifiers \| (\d+)/);
  if (countMatch) {
    const currentCount = parseInt(countMatch[1]!, 10);
    const newEntries = parseExistingEntries(newSection, version);
    // Count unique verifiers
    const uniqueVerifiers = new Set(newEntries.map((e) => e.verifier_id));
    newSection = newSection.replace(
      /Independent verifiers \| \d+/,
      `Independent verifiers | ${uniqueVerifiers.size}`
    );
  }

  // Update Verified status if any entry passed
  const allEntries = parseExistingEntries(newSection, version);
  const hasPassingVerifier = allEntries.some((e) => e.result === 'PASS');
  if (hasPassingVerifier) {
    newSection = newSection.replace(
      /Verified \| NO \(pending external verification\)/,
      'Verified | YES'
    );
  }

  // Replace section in content
  content = content.replace(sectionRegex, newSection);

  await writeFile(indexPath, content);
}

// =============================================================================
// Main Logic
// =============================================================================

async function ingestReport(version: string, submissionPath: string): Promise<void> {
  const absPath = resolve(submissionPath);
  const folderName = basename(absPath);

  console.log(`\nIngesting verifier report...`);
  console.log(`  Version: ${version}`);
  console.log(`  Path: ${absPath}`);

  // Validate folder name
  const { date, verifier_id } = validateFolderName(folderName);
  console.log(`  Date: ${date}`);
  console.log(`  Verifier ID: ${verifier_id}`);

  // Validate version format
  if (!/^v\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid version format: ${version}. Expected vX.Y.Z`);
  }

  // Check submission exists
  if (!existsSync(absPath)) {
    throw new Error(`Submission path does not exist: ${absPath}`);
  }

  // Validate required files
  console.log(`\nValidating required files...`);
  await validateRequiredFiles(absPath);
  console.log(`  ✓ VERIFIER_REPORT.md found`);

  // Check for and validate JSON
  const jsonPath = join(absPath, 'verifier_report.json');
  let jsonData: VerifierReportJson | null = null;

  if (existsSync(jsonPath)) {
    console.log(`\nValidating verifier_report.json...`);
    jsonData = await validateJsonSchema(jsonPath, SCHEMA_PATH);
    console.log(`  ✓ JSON schema validation passed`);
  } else {
    console.log(`\n  (No verifier_report.json - parsing markdown only)`);
  }

  // Parse markdown report
  console.log(`\nParsing VERIFIER_REPORT.md...`);
  const mdContent = await readFile(join(absPath, 'VERIFIER_REPORT.md'), 'utf-8');
  const metadata = parseMarkdownReport(mdContent, version);

  console.log(`  Release: ${metadata.release_tag}`);
  console.log(`  Result: ${metadata.result}`);
  console.log(`  OS: ${metadata.os}`);
  console.log(`  Node: ${metadata.node_version}`);
  console.log(`  npm: ${metadata.npm_version}`);
  console.log(`  Verifier: ${metadata.verifier_handle}`);

  // Cross-validate with JSON if present
  if (jsonData) {
    if (jsonData.release_version !== metadata.release_tag) {
      throw new Error(
        `Version mismatch between JSON (${jsonData.release_version}) and markdown (${metadata.release_tag})`
      );
    }
    if (jsonData.summary.result !== metadata.result) {
      throw new Error(
        `Result mismatch between JSON (${jsonData.summary.result}) and markdown (${metadata.result})`
      );
    }
  }

  // Determine destination
  const versionReportsDir = join(VERIFIER_REPORTS_BASE, version);
  const destDir = metadata.verified
    ? join(versionReportsDir, 'verified')
    : join(versionReportsDir, 'failed');
  const destPath = join(destDir, folderName);

  // Check destination doesn't already exist
  if (existsSync(destPath)) {
    throw new Error(`Destination already exists: ${destPath}`);
  }

  // Ensure destination directory exists
  await mkdir(destDir, { recursive: true });

  // Create index entry
  const entry: IndexEntry = {
    date,
    verifier_id,
    release_tag: version,
    result: metadata.result,
    os: metadata.os.slice(0, 30), // Truncate for table
    node: metadata.node_version,
    npm: metadata.npm_version,
    path: `${version}/${metadata.verified ? 'verified' : 'failed'}/${folderName}/`,
  };

  // Update INDEX.md first (before moving, so we can fail early on duplicates)
  console.log(`\nUpdating INDEX.md...`);
  await updateIndex(INDEX_PATH, version, entry);
  console.log(`  ✓ Index updated`);

  // Move submission folder
  console.log(`\nMoving submission...`);
  await rename(absPath, destPath);
  console.log(`  ✓ Moved to: ${destPath}`);

  // Summary
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`✓ Ingestion complete`);
  console.log(`  Result: ${metadata.result}`);
  console.log(`  Location: ${destPath}`);
  console.log(`${'─'.repeat(60)}\n`);
}

// =============================================================================
// CLI
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 2 || args.includes('--help') || args.includes('-h')) {
    console.log('Usage: npm run ingest-verifier -- <version> <path>');
    console.log('');
    console.log('Arguments:');
    console.log('  version    Release version (e.g., v0.2.1)');
    console.log('  path       Path to submission folder (e.g., .../incoming/20260105_acme/)');
    console.log('');
    console.log('Folder naming convention:');
    console.log('  YYYYMMDD_verifier_id (e.g., 20260105_acme)');
    console.log('');
    console.log('Required files in submission:');
    console.log('  - VERIFIER_REPORT.md (filled from template)');
    console.log('');
    console.log('Optional files:');
    console.log('  - verifier_report.json (must conform to schema)');
    console.log('  - attachments/ (logs, screenshots, etc.)');
    console.log('');
    console.log('Example:');
    console.log(
      '  npm run ingest-verifier -- v0.2.1 artifacts/verifier_reports/v0.2.1/incoming/20260105_acme/'
    );
    process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
  }

  const version = args[0]!;
  const submissionPath = args[1]!;

  await ingestReport(version, submissionPath);
}

// Only run CLI when this file is the entry point
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((err) => {
    console.error(`\n✗ Error: ${err.message || err}`);
    process.exit(1);
  });
}

// =============================================================================
// Exports for testing
// =============================================================================

export {
  validateFolderName,
  validateRequiredFiles,
  validateJsonSchema,
  parseMarkdownReport,
  parseExistingEntries,
  checkDuplicate,
  formatTableRow,
  updateIndex,
  ingestReport,
  type ParsedMetadata,
  type IndexEntry,
  type VerifierReportJson,
};
