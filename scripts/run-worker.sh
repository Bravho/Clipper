#!/bin/bash
# launchd entrypoint for the RClipper render worker.
# Wraps the worker in `caffeinate -s` so the Mac never system-sleeps while it
# runs, and pins PATH (launchd starts with a minimal PATH that lacks Homebrew).
set -euo pipefail

cd "$(dirname "$0")/.."

# Homebrew (Apple Silicon = /opt/homebrew) first, then Intel, then system.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export NODE_ENV="${NODE_ENV:-production}"

# Use the locally-installed tsx (devDependency). Run `npm ci` first if missing.
exec caffeinate -s ./node_modules/.bin/tsx scripts/render-worker.ts
