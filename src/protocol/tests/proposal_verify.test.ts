/**
 * Proposal Verify Tests (Internal)
 * =================================
 *
 * Internal tests for proposal verification against PR1-PR12 invariants.
 * These tests validate the internal Proposal type, not external artifacts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyProposal } from '../proposal_verify.js';
import { SCHEMA_VERSION } from '../../types/artifacts.js';
import type { Proposal, ProposedAction, AcceptanceTest } from '../proposal.js';
import { canonicalize } from '../../utils/canonical.js';

// =============================================================================
// Path Resolution
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../../..');
const FIXTURES_DIR = join(PROJECT_ROOT, 'src/protocol/tests/fixtures');

// =============================================================================
// Helper: Load Fixture
// =============================================================================

async function loadFixture(name: string): Promise<unknown> {
  const path = join(FIXTURES_DIR, name);
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content);
}

// =============================================================================
// Helper: Create Valid Proposal
// =============================================================================

function createValidProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 'prop_a1b2c3d4e5f67890',
    schema_version: SCHEMA_VERSION,
    source_bundle_id: 'bun_1234567890abcdef',
    source_bundle_hash: 'sha256:' + 'a'.repeat(64),
    actions: [
      {
        id: 'act_0000000000000001',
        type: 'create_file',
        target: 'src/test.ts',
        content: 'export const x = 1;\n',
        expected_hash: 'sha256:' + 'b'.repeat(64),
        required: true,
        description: 'Create test file',
        order: 0,
      },
    ],
    acceptance_tests: [
      {
        id: 'test_hash_act_0000000000000001',
        name: 'Verify hash',
        type: 'hash_match',
        target: 'src/test.ts',
        expected: 'sha256:' + 'b'.repeat(64),
        required: true,
      },
    ],
    summary: 'Create test file',
    requires_approval: false,
    confidence: 85,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Proposal Verification (Internal)', () => {
  describe('PR1: Schema Version Present', () => {
    it('valid schema version passes', () => {
      const proposal = createValidProposal();
      const result = verifyProposal(proposal);
      assert.ok(result.ok, 'Expected valid proposal to pass');
    });

    it('missing schema version fails', () => {
      const proposal = createValidProposal();
      delete (proposal as any).schema_version;
      const result = verifyProposal(proposal);
      assert.ok(!result.ok, 'Expected missing schema version to fail');
      assert.ok(result.violations?.some((v) => v.rule_id === 'PR1'), 'Expected PR1 violation');
    });

    it('empty schema version fails', () => {
      const proposal = createValidProposal({ schema_version: '' });
      const result = verifyProposal(proposal);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PR1'));
    });

    it('fixture: missing schema version fails', async () => {
      const proposal = await loadFixture('proposal_invalid_missing_schema.json');
      const result = verifyProposal(proposal);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PR1'));
    });
  });

  describe('PR2: Source References Valid', () => {
    it('valid source references pass', () => {
      const proposal = createValidProposal();
      const result = verifyProposal(proposal);
      assert.ok(result.ok);
    });

    it('missing source_bundle_id fails', () => {
      const proposal = createValidProposal();
      delete (proposal as any).source_bundle_id;
      const result = verifyProposal(proposal);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PR2'));
    });

    it('empty source_bundle_id fails', () => {
      const proposal = createValidProposal({ source_bundle_id: '' });
      const result = verifyProposal(proposal);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PR2'));
    });

    it('fixture: invalid source ref fails', async () => {
      const proposal = await loadFixture('proposal_invalid_source_ref.json');
      const result = verifyProposal(proposal);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PR2'));
    });
  });

  describe('PR3: Actions Array Present', () => {
    it('actions array present passes', () => {
      const proposal = createValidProposal();
      const result = verifyProposal(proposal);
      assert.ok(result.ok);
    });

    it('empty actions array passes', () => {
      const proposal = createValidProposal({ actions: [], acceptance_tests: [] });
      const result = verifyProposal(proposal);
      assert.ok(result.ok);
    });

    it('missing actions array fails', () => {
      const proposal = createValidProposal();
      delete (proposal as any).actions;
      const result = verifyProposal(proposal);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PR3'));
    });
  });

  describe('PR4: Action IDs Unique', () => {
    it('unique action IDs pass', () => {
      const proposal = createValidProposal({
        actions: [
          { id: 'act_0000000000000001', type: 'create_file', target: 'a.ts', content: 'a', required: true, description: 'Create a', order: 0 },
          { id: 'act_0000000000000002', type: 'create_file', target: 'b.ts', content: 'b', required: true, description: 'Create b', order: 1 },
        ],
      });
      const result = verifyProposal(proposal);
      assert.ok(result.ok);
    });

    it('duplicate action IDs fail', async () => {
      const proposal = await loadFixture('proposal_invalid_duplicate_action_ids.json');
      const result = verifyProposal(proposal);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PR4'));
    });
  });

  describe('PR5: Action Types Valid', () => {
    it('valid action types pass', () => {
      const proposal = createValidProposal();
      const result = verifyProposal(proposal);
      assert.ok(result.ok);
    });

    it('execute_command action passes', () => {
      const proposal = createValidProposal({
        actions: [{ id: 'act_0000000000000001', type: 'execute_command', target: 'npm test', required: true, description: 'Run tests', order: 0 }],
      });
      const result = verifyProposal(proposal);
      assert.ok(result.ok);
    });

    it('invalid action type fails', async () => {
      const proposal = await loadFixture('proposal_invalid_action_type.json');
      const result = verifyProposal(proposal);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PR5'));
    });
  });

  describe('PR6: Action IDs Well-Formed', () => {
    it('well-formed action IDs pass', () => {
      const proposal = createValidProposal();
      const result = verifyProposal(proposal);
      assert.ok(result.ok);
    });

    it('malformed action ID fails in strict mode', () => {
      const proposal = createValidProposal({
        actions: [{ id: 'bad_id', type: 'create_file', target: 'a.ts', content: 'a', required: true, description: 'Create', order: 0 }],
      });
      const result = verifyProposal(proposal, { strictActionIds: true });
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PR6'));
    });

    it('malformed action ID passes in relaxed mode', () => {
      const proposal = createValidProposal({
        actions: [{ id: 'bad_id', type: 'create_file', target: 'a.ts', content: 'a', required: true, description: 'Create', order: 0 }],
      });
      const result = verifyProposal({ ...proposal, id: 'relaxed_id' }, { strictActionIds: false, strictProposalId: false });
      assert.ok(result.ok);
    });
  });

  describe('PR7: Test IDs Unique', () => {
    it('unique test IDs pass', () => {
      const proposal = createValidProposal({
        acceptance_tests: [
          { id: 'test_1', name: 'Test 1', type: 'hash_match', target: 'a.ts', expected: 'sha256:' + 'a'.repeat(64), required: true },
          { id: 'test_2', name: 'Test 2', type: 'hash_match', target: 'b.ts', expected: 'sha256:' + 'b'.repeat(64), required: true },
        ],
      });
      const result = verifyProposal(proposal);
      assert.ok(result.ok);
    });

    it('duplicate test IDs fail', () => {
      const proposal = createValidProposal({
        acceptance_tests: [
          { id: 'test_1', name: 'Test 1', type: 'hash_match', target: 'a.ts', expected: 'sha256:' + 'a'.repeat(64), required: true },
          { id: 'test_1', name: 'Test 2', type: 'hash_match', target: 'b.ts', expected: 'sha256:' + 'b'.repeat(64), required: true },
        ],
      });
      const result = verifyProposal(proposal);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PR7'));
    });
  });

  describe('PR8: Test Types Valid', () => {
    it('valid test types pass', () => {
      const proposal = createValidProposal();
      const result = verifyProposal(proposal);
      assert.ok(result.ok);
    });

    it('invalid test type fails', () => {
      const proposal = createValidProposal({
        acceptance_tests: [{ id: 'test_1', name: 'Test', type: 'invalid_type' as any, target: 'a.ts', expected: 'value', required: true }],
      });
      const result = verifyProposal(proposal);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PR8'));
    });
  });

  describe('PR9: Confidence Range Valid', () => {
    it('confidence 0 passes', () => {
      const proposal = createValidProposal({ confidence: 0 });
      const result = verifyProposal(proposal);
      assert.ok(result.ok);
    });

    it('confidence 100 passes', () => {
      const proposal = createValidProposal({ confidence: 100 });
      const result = verifyProposal(proposal);
      assert.ok(result.ok);
    });

    it('confidence -1 fails', () => {
      const proposal = createValidProposal({ confidence: -1 });
      const result = verifyProposal(proposal);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PR9'));
    });

    it('confidence 101 fails', async () => {
      const proposal = await loadFixture('proposal_invalid_confidence.json');
      const result = verifyProposal(proposal);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PR9'));
    });

    it('confidence as float fails', () => {
      const proposal = createValidProposal({ confidence: 50.5 });
      const result = verifyProposal(proposal);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PR9'));
    });
  });

  describe('PR10: Summary Non-Empty', () => {
    it('non-empty summary passes', () => {
      const proposal = createValidProposal({ summary: 'Valid summary' });
      const result = verifyProposal(proposal);
      assert.ok(result.ok);
    });

    it('missing summary fails', () => {
      const proposal = createValidProposal();
      delete (proposal as any).summary;
      const result = verifyProposal(proposal);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PR10'));
    });

    it('empty summary fails', () => {
      const proposal = createValidProposal({ summary: '' });
      const result = verifyProposal(proposal);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PR10'));
    });
  });

  describe('PR11: Sorting Canonical', () => {
    it('properly sorted actions pass', () => {
      const proposal = createValidProposal({
        actions: [
          { id: 'act_0000000000000001', type: 'create_file', target: 'a.ts', content: 'a', required: true, description: 'Create a', order: 0 },
          { id: 'act_0000000000000002', type: 'create_file', target: 'b.ts', content: 'b', required: true, description: 'Create b', order: 1 },
        ],
      });
      const result = verifyProposal(proposal);
      assert.ok(result.ok);
    });

    it('unsorted actions fail', async () => {
      const proposal = await loadFixture('proposal_invalid_unsorted.json');
      const result = verifyProposal(proposal);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PR11'));
    });

    it('unsorted tests fail', () => {
      const proposal = createValidProposal({
        acceptance_tests: [
          { id: 'test_z', name: 'Test Z', type: 'hash_match', target: 'z.ts', expected: 'sha256:' + 'z'.repeat(64), required: true },
          { id: 'test_a', name: 'Test A', type: 'hash_match', target: 'a.ts', expected: 'sha256:' + 'a'.repeat(64), required: true },
        ],
      });
      const result = verifyProposal(proposal);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PR11'));
    });
  });

  describe('PR12: File Actions Have Content', () => {
    it('create_file with content passes', () => {
      const proposal = createValidProposal();
      const result = verifyProposal(proposal);
      assert.ok(result.ok);
    });

    it('create_file without content fails', async () => {
      const proposal = await loadFixture('proposal_invalid_file_no_content.json');
      const result = verifyProposal(proposal);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PR12'));
    });

    it('delete_file without content passes', () => {
      const proposal = createValidProposal({
        actions: [{ id: 'act_0000000000000001', type: 'delete_file', target: 'a.ts', required: true, description: 'Delete file', order: 0 }],
      });
      const result = verifyProposal(proposal);
      assert.ok(result.ok);
    });

    it('delete_file with content fails', () => {
      const proposal = createValidProposal({
        actions: [{ id: 'act_0000000000000001', type: 'delete_file', target: 'a.ts', content: 'should not exist', required: true, description: 'Delete file', order: 0 } as any],
      });
      const result = verifyProposal(proposal);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PR12'));
    });
  });

  describe('Fixture: Valid Proposal', () => {
    it('valid fixture passes all checks', async () => {
      const proposal = await loadFixture('proposal_valid_embedded.json');
      const result = verifyProposal(proposal);
      assert.ok(result.ok, `Expected valid proposal to pass: ${JSON.stringify(result)}`);
    });
  });

  describe('Stable Violations', () => {
    it('violations are sorted by rule_id then path', () => {
      const proposal = {
        id: 'bad',
        source_bundle_id: '',
        source_bundle_hash: 'not-sha256',
        actions: [
          { id: 'bad_1', type: 'invalid', target: 'a', order: 1 },
          { id: 'bad_2', type: 'create_file', target: 'b', order: 0 },
        ],
        acceptance_tests: [],
        summary: '',
        confidence: 200,
      };

      const result1 = verifyProposal(proposal);
      const result2 = verifyProposal(proposal);

      assert.ok(!result1.ok && !result2.ok);
      const json1 = canonicalize(result1);
      const json2 = canonicalize(result2);
      assert.strictEqual(json1, json2, 'Violations should be deterministically sorted');
    });
  });

  describe('Schema Errors', () => {
    it('null input fails', () => {
      const result = verifyProposal(null);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'SCHEMA'));
    });

    it('array input fails', () => {
      const result = verifyProposal([]);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'SCHEMA'));
    });

    it('empty object fails', () => {
      const result = verifyProposal({});
      assert.ok(!result.ok);
      assert.ok((result.violations?.length ?? 0) > 1);
    });
  });
});
