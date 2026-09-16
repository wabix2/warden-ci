# Warden benchmark

Warden keeps two benchmark layers:

- `benchmarks/package-risk-fixtures.json` is a small regression suite for deterministic behavior.
- `benchmarks/evaluation/package-risk-v1.json` is an evaluation corpus. The current corpus is explicitly synthetic local metadata fixtures and must not be presented as real-world accuracy evidence.

Run the evaluation with:

```bash
pnpm build
node scripts/evaluate-package-risk.mjs
```

The runner writes `benchmarks/reports/package-risk-v1.json` and reports confusion counts, precision, recall, F1, coverage, UNKNOWN rate, median latency, and category-level results. A positive means a risk verdict; `safe` is the negative class; `registry-unavailable` is measured separately as UNKNOWN and is never treated as safe.

A public real-world benchmark requires a versioned registry snapshot, retrieval dates, labeling rules, ecosystem-specific fixtures, and independent review. Those data are not present in this repository, so no real-world accuracy claim is made.
