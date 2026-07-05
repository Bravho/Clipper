# Phase 3 — Run the worker + retention sweep as launchd services

Run these on the **Mac Mini** after Phase 0 (`docs/mac-worker-setup.md`) is green and
`.env.local` is populated. Everything here is user-level `launchd` (no `sudo`, no root
LaunchDaemon). Paths assume the repo at `/Users/admin/Projects/Video_Processor_RClipper`;
edit the plists if yours differs.

```bash
export REPO=/Users/admin/Projects/Video_Processor_RClipper
cd "$REPO"
npm ci                       # ensures tsx + deps are installed
mkdir -p ~/Library/Logs/rclipper
```

---

## 1. Sanity-check the worker by hand first

```bash
cd "$REPO"
npx tsx scripts/render-worker.ts --once
```

Expect a `starting … {"concurrency":1,…}` line, then either it claims+runs a queued step or
logs no work and exits. If it errors on Postgres/Spaces, fix `.env.local` before installing
the service. **PASTE BACK** the output.

---

## 2. Install the worker LaunchAgent (restart on crash/reboot, keeps Mac awake)

`run-worker.sh` wraps the worker in `caffeinate -s`, so the Mac won't system-sleep while it
runs. (If you also want to guarantee no display/idle sleep independent of the worker:
`sudo pmset -a sleep 0` — optional.)

```bash
cp deploy/launchd/com.rclipper.worker.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.rclipper.worker.plist
launchctl enable  gui/$(id -u)/com.rclipper.worker
launchctl kickstart -k gui/$(id -u)/com.rclipper.worker

# Verify it's running and tail the log:
launchctl print gui/$(id -u)/com.rclipper.worker | grep -E "state|pid" | head
tail -f ~/Library/Logs/rclipper/worker.out.log
```

A steady heartbeat means the web droplet will now enqueue heavy steps to this Mac.
To stop/uninstall:

```bash
launchctl bootout gui/$(id -u)/com.rclipper.worker
rm ~/Library/LaunchAgents/com.rclipper.worker.plist
```

**PASTE BACK** the `launchctl print … state/pid` lines and the first worker-log lines.

---

## 3. Retention sweep — DRY-RUN first, then enable

Before automating, run it once by hand in dry-run and review what it *would* delete:

```bash
cd "$REPO"
node scripts/retention-sweep.js --dry-run
```

This prints, per rule, how many objects it would delete (delivered clips > 7 days; requests
inactive > 30 days → auto-cancel + purge). **PASTE BACK** the full output — I'll confirm the
counts look right before you enable live deletion.

Then install the daily job (the plist ships with `--dry-run` still on):

```bash
cp deploy/launchd/com.rclipper.retention-sweep.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.rclipper.retention-sweep.plist
launchctl enable  gui/$(id -u)/com.rclipper.retention-sweep
launchctl kickstart -k gui/$(id -u)/com.rclipper.retention-sweep   # run once now
cat ~/Library/Logs/rclipper/retention-sweep.out.log
```

**Only after** the dry-run output looks correct, go live: edit
`deploy/launchd/com.rclipper.retention-sweep.plist`, delete the `<string>--dry-run</string>`
line, then re-load:

```bash
launchctl bootout gui/$(id -u)/com.rclipper.retention-sweep 2>/dev/null || true
cp deploy/launchd/com.rclipper.retention-sweep.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.rclipper.retention-sweep.plist
launchctl enable gui/$(id -u)/com.rclipper.retention-sweep
```

---

## 4. Acceptance test (end-to-end)

With the worker running, submit a test request on the droplet and drive it to the first heavy
step. You should see, in `worker.out.log`:

```
claimed step {"job":"…","step":"montage_all_segments",…}
step done {"job":"…","step":"…","seconds":NN.N}
```

and the web UI advancing through the approval gates to a final clip in all required ratios.

Resilience checks:
- **Kill mid-job** (`launchctl kickstart -k …` or `kill` the tsx pid): the claim's keep-alive
  goes stale after `RENDER_STALE_CLAIM_SECONDS` (default 600s) and another worker run reclaims
  and resumes it.
- **Worker off past the heartbeat window** (`launchctl bootout …`): after
  `RENDER_WORKER_FRESH_SECONDS` (default 45s) with no heartbeat, the droplet stops enqueuing
  and runs the step itself (fallback) — the pipeline still completes.
