# Warden proof-of-value fixture

This fixture describes the safe deterministic workflow used for demonstrations. It does not install or execute malware.

1. A developer introduces a legitimate dependency and a fabricated dependency during an AI-assisted workflow.
2. Warden extracts package/import metadata only.
3. The registry provider returns either verified metadata, not-found, or unavailable.
4. The shared risk engine produces a verdict with confidence, reasons, and evidence.
5. Policy maps the verdict to allow, warn, or block.
6. The IDE/CI surface presents the evidence and the developer remains in control.

The canonical executable regression inputs are in `benchmarks/package-risk-fixtures.json`; the synthetic evaluation corpus is in `benchmarks/evaluation/package-risk-v1.json`.
