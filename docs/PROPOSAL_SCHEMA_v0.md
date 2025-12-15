# Proposal Schema v0

## 1. Purpose

Proposal Schema v0 defines the input contract for all requests entering the Motherlabs kernel. A proposal is a structured declaration of intent that must pass deterministic validation before any execution or ledger admission occurs. This schema enables fail-closed rejection: if a proposal does not conform exactly, it is refused without side effects. The schema is designed for machine validation first, human readability second.

## 2. Status and Non-Goals

This schema:

- Does NOT authorize execution (authorization requires a separate ALLOW gate decision)
- Does NOT define tool implementations or runtime behavior
- Does NOT replace gate decisions or six-gate validation
- Does NOT permit implicit defaults (all required fields must be explicit)
- Does NOT interpret intent (normalization is a separate concern)
- Does NOT admit proposals to the ledger (admission requires schema registry approval)

## 3. Canonical Proposal Object

```json
{
  "version": "v0",
  "proposal_id": "<content-addressed-id>",
  "intent": "<non-empty string>",
  "requested_action": "<action-verb>",
  "targets": [
    {
      "kind": "<target-kind>",
      "identifier": "<path-or-id>"
    }
  ],
  "constraints": {},
  "evidence_plan": {},
  "provenance": {
    "source": "<origin>",
    "timestamp_utc": "<ISO-8601>"
  },
  "metadata": {}
}
```

## 4. Field Semantics

### version
- **Meaning**: Schema version identifier
- **Allowed values**: Exactly `"v0"`
- **Required**: Yes
- **Determinism**: Must be literal `"v0"`; no variation allowed

### proposal_id
- **Meaning**: Unique identifier for this proposal
- **Allowed values**: Non-empty string; should be content-addressed hash of proposal body (excluding this field) or format `prop_<date>_<seq>`
- **Required**: Yes
- **Determinism**: Same proposal content must produce same ID

### intent
- **Meaning**: Human-readable statement of what is requested
- **Allowed values**: Non-empty string, no embedded JSON or code blocks
- **Required**: Yes
- **Determinism**: Treated as opaque string; no normalization applied by schema

### requested_action
- **Meaning**: The verb describing what action is requested
- **Allowed values**: One of: `"create"`, `"update"`, `"delete"`, `"analyze"`, `"verify"`, `"plan"`
- **Required**: Yes
- **Determinism**: Must be exact match from allowed set

### targets
- **Meaning**: Array of objects identifying what the action applies to
- **Allowed values**: Array with at least one element; each element has `kind` and `identifier`
- **Required**: Yes (minimum 1 target)
- **Determinism**: Order matters; duplicates allowed but discouraged

#### targets[].kind
- **Allowed values**: One of: `"file"`, `"directory"`, `"module"`, `"function"`, `"document"`, `"system"`

#### targets[].identifier
- **Allowed values**: Non-empty string; relative path or qualified name

### constraints
- **Meaning**: Object containing restrictions or requirements for the action
- **Allowed values**: Object (may be empty `{}`)
- **Required**: Yes (presence required; content optional)
- **Determinism**: Keys and values treated as opaque; no normalization

### evidence_plan
- **Meaning**: Object describing how success will be verified
- **Allowed values**: Object (may be empty `{}`)
- **Required**: Yes (presence required; content optional)
- **Determinism**: Keys and values treated as opaque

### provenance
- **Meaning**: Object declaring the origin and timing of the proposal
- **Required**: Yes

#### provenance.source
- **Allowed values**: One of: `"cli"`, `"api"`, `"human"`, `"automated"`
- **Required**: Yes

#### provenance.timestamp_utc
- **Allowed values**: ISO-8601 string (e.g., `"2025-12-15T12:00:00Z"`)
- **Required**: Yes
- **Determinism**: Must be provided explicitly; must not be read from wall-clock during validation

### metadata
- **Meaning**: Optional bag for non-validated extension data
- **Allowed values**: Object (may be empty or omitted)
- **Required**: No
- **Determinism**: Contents are not validated; presence does not affect proposal validity

## 5. Validation Rules (Fail-Closed)

A proposal MUST be rejected if any of the following conditions hold:

1. **Unknown top-level fields**: Any field not in the canonical set (except `metadata`) causes rejection
2. **Missing required fields**: `version`, `proposal_id`, `intent`, `requested_action`, `targets`, `constraints`, `evidence_plan`, `provenance` must all be present
3. **Empty intent**: `intent` is empty string or whitespace-only
4. **Empty targets**: `targets` array has zero elements
5. **Invalid version**: `version` is not exactly `"v0"`
6. **Invalid requested_action**: Value not in allowed enum set
7. **Invalid target kind**: Any target has `kind` not in allowed enum set
8. **Empty target identifier**: Any target has empty `identifier`
9. **Missing provenance fields**: `provenance.source` or `provenance.timestamp_utc` missing
10. **Embedded payloads**: `intent` contains JSON objects, code blocks, or multi-line structured data
11. **TCB path targets**: Targets referencing TCB-protected paths will be rejected by downstream gate validation (not by schema validation itself)

Rejection is immediate and produces no side effects. No partial validation.

## 6. Determinism Rules

**Invariant**: Same input with fixed timestamp produces byte-identical validation output.

- `provenance.timestamp_utc` must be provided explicitly in the proposal
- Validators must not call wall-clock functions during validation
- Different timestamps intentionally produce different `proposal_id` values (if timestamp is part of ID computation)
- Field ordering in output must be deterministic (alphabetical or schema-defined)

Validators must be pure functions: no I/O, no randomness, no implicit time.

## 7. Minimal Examples

### Example 1: Valid Minimal Proposal

```json
{
  "version": "v0",
  "proposal_id": "prop_2025-12-15_000001",
  "intent": "Add input validation to user registration endpoint",
  "requested_action": "update",
  "targets": [
    {
      "kind": "file",
      "identifier": "src/api/register.ts"
    }
  ],
  "constraints": {},
  "evidence_plan": {},
  "provenance": {
    "source": "cli",
    "timestamp_utc": "2025-12-15T12:00:00Z"
  }
}
```

### Example 2: Invalid Proposal

```json
{
  "version": "v1",
  "intent": "",
  "requested_action": "modify",
  "targets": [],
  "provenance": {
    "source": "cli"
  }
}
```

**Rejection reasons**:
- `version` is `"v1"`, must be `"v0"`
- `intent` is empty string
- `requested_action` is `"modify"`, not in allowed set
- `targets` array is empty
- `proposal_id` is missing
- `constraints` is missing
- `evidence_plan` is missing
- `provenance.timestamp_utc` is missing

## 8. Compatibility / Future Versions

- Version `v1` and beyond may add new required or optional fields
- New versions will use distinct `version` values (`"v1"`, `"v2"`, etc.)
- Validators must reject unknown versions (fail-closed)
- The `metadata` field provides forward-compatible extension without schema changes
- Field semantics established in `v0` will not change meaning in future versions (additive only)
