Verifier Reports for v0.2.1
============================

This directory collects external verification reports for context-engine-kernel v0.2.1.

Submitting a Report
-------------------

1. Copy docs/VERIFIER_REPORT.template.md to this directory
2. Rename it: REPORT_<handle>_<date>.md (e.g., REPORT_alice_2026-01-06.md)
3. Fill out all sections
4. Optionally include a JSON report matching docs/verifier_report.schema.json

Report Naming Convention
------------------------

Markdown: REPORT_<handle>_<YYYY-MM-DD>.md
JSON:     REPORT_<handle>_<YYYY-MM-DD>.json

Where:
  - <handle> is your name or pseudonym (lowercase, underscores for spaces)
  - <YYYY-MM-DD> is the verification date

Expected Results (v0.2.1)
-------------------------

Source archive SHA256: d6f5a30c7067291ec4153eb1140b8204fc203c3fe52a666df0ce15596a086ac4
Git tag commit:        a55e3f9f9c4cbd32b8bd48ea1cbf342ab451b762
Node version:          v24.11.1
Tests:                 193 pass, 0 fail
Golden suite:          10 passed, 0 failed, 0 changed, 0 new

Verification Checklist
----------------------

Before submitting, confirm:

[ ] All tests pass (193/193)
[ ] Golden suite passes (10/10)
[ ] Source archive hash matches
[ ] Used Node.js v24.11.1 exactly
[ ] Clean environment (fresh clone, npm ci)

Contact
-------

For questions: https://github.com/motherlabs/context-engine-kernel/issues
