# Warden privacy model

Warden's package verification flow is package-level by design. The extension extracts dependency/import names and sends ecosystem, package name, and server configuration to the configured package-check endpoint. It does not send complete source files or AI prompts for package verification.

Local source text is analyzed by the extension to identify imports. Registry metadata is fetched by the Warden server or provider implementation. Repository and GitHub metadata may be processed by GitHub workflows where those integrations are enabled.

This repository does not claim production telemetry or AI provenance collection. Any future telemetry must be configurable, documented, and must not collect source code or prompts by default.

## Verification status

The package-check request is limited to ecosystem, package name, and configured endpoint. Deployed traffic inspection, retention enforcement, and provider-specific operational logs remain UNVERIFIED in this environment. Existing corpus logging controls are opt-in and must remain separately documented from package verification.
