# Data & automation interface

The app uses browser `localStorage` key `closedloop_research_os_v1` with top-level collections `runs`, `survivors`, `prs`, `tests`, `hypotheses`, `evidence`, and `actions`. Export from the UI to inspect the full current JSON.

## Run record

```json
{
  "id": "run-2026-11-02",
  "date": "2026-11-02",
  "label": "Nov 02 · Nightly",
  "branch": "",
  "sha": "",
  "status": "metadata only",
  "source": "source file or URL",
  "summary": "Narrative of observed changes",
  "baselineScore": "",
  "submissionScore": "",
  "notes": "",
  "complete": false,
  "snapshots": [
    {"key":"stable-survivor-id","label":"Display name","classification":"q3","streak":"","score":"","confidence":"","notes":""}
  ]
}
```

Use the **same `snapshots[].key` across runs**. A record missing from an incomplete run is **unknown**, not eliminated. Classification changes are computed when both sides have the same stable key. Streak changes require both sides to have numeric streak values.

## Suggested nightly ingestion contract

1. Capture run metadata: UTC event time, local date, branch, immutable commit SHA, source artifact URL, code version and scoring baseline.
2. Export **all eligible survivors**, including stable keys, classes, streaks and scores. Clearly distinguish full manifests from partial logs.
3. Include null controls, raw counts vs distinct hits, run IDs, evidence hash and any failed tests.
4. Preserve old snapshots rather than overwriting them. Use manual JSON import/CSV paste in this site; a later server integration can validate and ingest the same shape automatically.
5. Compare the run against its actual baseline; do not silently change what denominator, eligible population, score or classifier definition means.

## Risk and evidence conventions

PR status is a **manual record** until a live GitHub integration is installed. Risk notes are hypotheses about what to test, not confirmed faults. Evidence `confidence` is a provenance/verification level; do not treat a previous conversation summary as a reproduced result. Always scope negative results to the exact tested hypothesis and controls.