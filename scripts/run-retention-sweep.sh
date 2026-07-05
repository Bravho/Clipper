#!/bin/bash
# launchd entrypoint for the daily retention sweep.
# Pass --dry-run here while validating; remove it to enable live deletions.
set -euo pipefail

cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

exec node scripts/retention-sweep.js "$@"
