# Package-risk benchmark

`package-risk-fixtures.json` is a small deterministic regression fixture set for the risk engine. It uses mocked registry metadata so results do not depend on network state. The fixture set covers safe, nonexistent, typosquat, dependency-confusion, maintainer-change, and unavailable-registry cases.

Run `pnpm benchmark:package-risk`. The command prints JSON containing the fixture count, pass/fail counts, and per-case results. These are regression results, not field accuracy metrics: the dataset is synthetic, small, npm-focused, and does not measure real-world precision or recall.
