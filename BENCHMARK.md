# Warden benchmark methodology

Warden keeps three datasets separate:

1. **Regression fixtures**: six deterministic cases used to prevent known behavior regressions.
2. **Synthetic evaluation**: ten recorded-metadata fixtures with explicit labels. The current report is synthetic local evidence, not real-world accuracy.
3. **External evaluation**: `benchmarks/evaluation/external/` accepts provenance-backed fixtures only. The current external corpus is empty, so external metrics are NOT MEASURED.

Reports include corpus version, fixture count, provenance, retrieval date, label methodology, ecosystem/category distributions, exclusions, UNKNOWN and registry-failure rates, TP/TN/FP/FN, precision, recall, F1, specificity, false-positive/negative rates, coverage, and latency percentiles.

UNKNOWN is never collapsed into safe or unsafe. Unresolved external examples must be excluded from accuracy metrics and reported as exclusions. Synthetic results must not be used to claim production accuracy or an SLA.

<!-- GENERATED_ECOSYSTEM_STATUS -->
- npm: .js, .jsx, .ts, .tsx, .mjs, .cjs, .mts, .cts (147 popular references; refresh-backed)
- pypi: .py (108 popular references; refresh-backed)
- cargo: .rs, .toml (0 popular references; no live ranking source configured)
- go: .go (4 popular references; no live ranking source configured)
- rubygems.org: .rb, .gemspec, .gemfile (0 popular references; no live ranking source configured)
<!-- END_GENERATED_ECOSYSTEM_STATUS -->
