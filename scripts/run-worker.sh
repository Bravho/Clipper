#!/bin/bash
# launchd entrypoint for the RClipper render worker.
# Wraps the worker in `caffeinate -s` so the Mac never system-sleeps while it
# runs, and pins PATH (launchd starts with a minimal PATH that lacks Homebrew).
set -euo pipefail

cd "$(dirname "$0")/.."

# Homebrew (Apple Silicon = /opt/homebrew) first, then Intel, then system.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export NODE_ENV="${NODE_ENV:-production}"

# Belt-and-suspenders for the DigitalOcean Spaces 400 "UnknownError": the S3
# clients already set requestChecksumCalculation/responseChecksumValidation to
# WHEN_REQUIRED in code (src/lib/spaces.ts), but these env vars force the same
# behaviour for ANY S3 client the worker constructs, so the default CRC32
# integrity checksums (which DO Spaces rejects) can never be re-introduced.
export AWS_REQUEST_CHECKSUM_CALCULATION="${AWS_REQUEST_CHECKSUM_CALCULATION:-WHEN_REQUIRED}"
export AWS_RESPONSE_CHECKSUM_VALIDATION="${AWS_RESPONSE_CHECKSUM_VALIDATION:-WHEN_REQUIRED}"

# Use the locally-installed tsx (devDependency). Run `npm ci` first if missing.
exec caffeinate -s ./node_modules/.bin/tsx scripts/render-worker.ts
