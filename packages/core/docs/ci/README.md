# CI install (at cutover)
The git token used locally lacks `workflow` scope, so Actions files can't be
pushed from here. At cutover: `mkdir -p .github/workflows && cp packages/core/docs/ci/core-ci.yml.install-at-cutover .github/workflows/core-ci.yml`
and push from a credential with workflow scope (or paste via the GitHub UI).
