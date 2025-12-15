# Ring-2 Proposer Contract

**Version**: 1.0
**Status**: GOVERNING
**Effective**: December 2025

---

## Purpose

This document defines the behavioral contract for Ring-2 Proposers in the Motherlabs governance architecture. Ring-2 is the outer ring where proposals are created and submitted, but where NO direct authorization decisions are made.

**Core Principle**: Ring-2 can REQUEST but cannot DECIDE.

---

## Ring Architecture

```
+----------------------------------------------------------+
|  RING-0: KERNEL (Constitutional Layer)                   |
|  - Ledger hash chain                                     |
|  - Genesis record                                        |
|  - Immutable by design                                   |
+----------------------------------------------------------+
|  RING-1: TCB (Trusted Computing Base)                    |
|  - Schema Registry (fail-closed)                         |
|  - Authorization Router (deny-by-default)                |
|  - Gate Decision System                                  |
|  - TCB Boundary Enforcement                              |
+----------------------------------------------------------+
|  RING-2: PROPOSER (This contract)                        |
|  - Proposal creation                                     |
|  - Intent specification                                  |
|  - Target identification                                 |
|  - Evidence planning                                     |
+----------------------------------------------------------+
|  RING-3: EXTERNAL (Untrusted)                            |
|  - User input                                            |
|  - LLM output                                            |
|  - External APIs                                         |
+----------------------------------------------------------+
```

---

## Ring-2 Proposer Capabilities

### ALLOWED

1. **Create Proposal Objects**
   - Construct `ProposalV0` objects conforming to schema
   - Specify intent, targets, constraints, and evidence plans
   - Include provenance information

2. **Submit to Admission Service**
   - Call `admitProposal(input)` on admission service
   - Receive admission result (success or rejection)
   - Handle validation errors

3. **Query Ledger State** (read-only)
   - Read existing records
   - Verify hash chain
   - Check proposal status

### PROHIBITED

1. **Make Authorization Decisions**
   - Cannot issue GATE_DECISION records directly
   - Cannot bypass admission service
   - Cannot modify existing ledger records

2. **Access Ring-1 Internals**
   - Cannot modify Schema Registry
   - Cannot bypass Authorization Router
   - Cannot alter TCB components

3. **Forge Provenance**
   - Must accurately represent proposal source
   - Cannot claim human provenance for automated proposals
   - Cannot backdate timestamps

---

## Proposal Lifecycle from Ring-2

```
Ring-2 Proposer                Ring-1 Authorization
      │                              │
      │  1. Create proposal object   │
      │                              │
      │  2. Submit to admission ────►│
      │     service                  │
      │                              │  3. Validate against
      │                              │     ProposalV0 schema
      │                              │
      │                              │  4. Record GATE_DECISION
      │                              │     (ALLOW or DENY)
      │                              │
      │                              │  5. If ALLOW, admit
      │                              │     proposal to ledger
      │                              │
      │◄──── 6. Return result ───────│
      │                              │
```

---

## API Contract

### Creating a Proposal

```typescript
import { createAdmissionService } from '../src/proposal/admissionService'

// Ring-2 code creates proposal object
const proposal = {
  version: 'v0',
  proposal_id: 'prop_2025-12-15_001',
  intent: 'Description of what should be done',
  requested_action: 'create' | 'update' | 'delete' | 'analyze' | 'verify' | 'plan',
  targets: [
    { kind: 'file', identifier: 'src/path/to/file.ts' },
    { kind: 'module', identifier: 'src/feature' }
  ],
  constraints: {
    // Optional constraints on how work should be done
  },
  evidence_plan: {
    // Plan for what evidence will demonstrate success
  },
  provenance: {
    source: 'cli' | 'api' | 'human' | 'automated',
    timestamp_utc: new Date().toISOString()
  },
  metadata: {
    // Optional freeform metadata
  }
}

// Submit to Ring-1 via admission service
const service = createAdmissionService(ledger, 'ring2_proposer_id')
const result = await service.admitProposal(proposal)

if (result.ok && result.value.admitted) {
  // Proposal was admitted - proceed with work
  console.log('Proposal admitted:', result.value.proposalRecord)
} else if (result.ok && !result.value.admitted) {
  // Proposal was rejected - handle validation errors
  console.log('Rejected:', result.value.validationErrors)
} else {
  // System error - not a validation issue
  console.error('Error:', result.error)
}
```

### Understanding Results

| Result State | Meaning |
|-------------|---------|
| `ok=true, admitted=true` | Proposal passed validation and was admitted to ledger |
| `ok=true, admitted=false` | Proposal failed validation; DENY recorded in ledger |
| `ok=false` | System error (ledger write failure, not validation) |

---

## Invariants Ring-2 Must Respect

### I1: Schema Conformance

Every proposal submitted MUST conform to the `ProposalV0` schema. The admission service will reject non-conforming proposals, but Ring-2 code should validate locally first when possible.

### I2: Honest Provenance

The `provenance.source` field MUST accurately reflect the proposal's origin:

| Source | Meaning |
|--------|---------|
| `cli` | Submitted via command-line interface |
| `api` | Submitted via programmatic API |
| `human` | Directly created by a human |
| `automated` | Generated by automated system (LLM, script) |

### I3: No Direct Ledger Writes

Ring-2 code MUST NOT write directly to the ledger. All writes go through the admission service, which enforces gate decisions.

### I4: Immutable Submission

Once a proposal is submitted, it cannot be modified. To change a proposal, submit a new proposal with a new `proposal_id`.

### I5: Single Target Scope

Each proposal should have a clear, bounded scope. Avoid proposals that try to do too many things. Multiple small proposals are preferred over one large proposal.

---

## Error Handling

### Validation Errors

When a proposal fails validation, the admission result includes structured errors:

```typescript
type ValidationError = {
  code: string      // Machine-readable error code
  message: string   // Human-readable description
  field?: string    // Field that caused the error
}
```

Common error codes:
- `NOT_AN_OBJECT` - Input was not an object
- `MISSING_REQUIRED_FIELD` - Required field absent
- `INVALID_VERSION` - Version must be 'v0'
- `EMPTY_INTENT` - Intent cannot be empty
- `INVALID_REQUESTED_ACTION` - Action not in allowed set
- `TARGETS_EMPTY` - Must specify at least one target
- `UNKNOWN_FIELD` - Unexpected field (fail-closed)

### Recovery Strategy

1. **Parse error codes** - Use `code` field for programmatic handling
2. **Fix and retry** - Correct the issue and submit again
3. **Do not retry blindly** - Same input will produce same error

---

## Testing Ring-2 Code

### Unit Testing

Test proposal creation in isolation:

```typescript
import { validateProposalV0 } from '../src/validation/proposalV0Validator'

describe('My Ring-2 Proposer', () => {
  it('creates valid proposals', () => {
    const proposal = myProposerFunction()
    const result = validateProposalV0(proposal)
    expect(result.ok).toBe(true)
  })
})
```

### Integration Testing

Test with a real ledger (in temp directory):

```typescript
const ledger = new JSONLLedger('/tmp/test-ledger.jsonl')
const service = createAdmissionService(ledger, 'test')

const result = await service.admitProposal(myProposal)
expect(result.ok).toBe(true)
expect(result.value.admitted).toBe(true)

// Verify ledger state
const records = ledger.readAll()
// ... assertions
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-15 | Initial contract definition |

---

## References

- [PROPOSAL_SCHEMA_v0.md](PROPOSAL_SCHEMA_v0.md) - Full schema specification
- [MOTHERLABS_CONSTITUTION.md](MOTHERLABS_CONSTITUTION.md) - Constitutional foundation
- [FREEZE_MANIFEST.md](FREEZE_MANIFEST.md) - Governance freeze manifest
