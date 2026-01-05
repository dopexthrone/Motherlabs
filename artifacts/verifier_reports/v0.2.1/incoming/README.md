# Incoming Verifier Reports (v0.2.1)

Place incoming verifier submissions here before processing.

## Naming Convention

Each submission must be in a folder named:
```
<YYYYMMDD>_<verifier_id>/
```

Example: `20260105_acme/`

## Required Contents

```
<YYYYMMDD>_<verifier_id>/
├── VERIFIER_REPORT.md     (required - filled from template)
├── verifier_report.json   (optional - must conform to schema)
└── attachments/           (optional - logs, screenshots, etc.)
```

## Processing

Run:
```bash
npm run ingest-verifier -- v0.2.1 artifacts/verifier_reports/v0.2.1/incoming/<folder>/
```

Successfully verified submissions move to `../verified/`.
Failed submissions move to `../failed/`.
