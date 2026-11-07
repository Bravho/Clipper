/**
 * True multi-process contention. The ledger module is compiled to plain JS in a
 * temporary folder (outside the repo), and separate Node processes hammer the
 * same ledger and lock files. Nothing live is touched.
 */
import { promises as fsp } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const SOURCE = path.resolve(__dirname, "../../../src/lib/lab/labSpendLedger.ts");

async function compileLedger(outDir: string): Promise<string> {
  const source = await fsp.readFile(SOURCE, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const file = path.join(outDir, "labSpendLedger.js");
  await fsp.writeFile(file, js, "utf8");
  return file;
}

/** Child process: make `count` reservations of 350 against the shared files, print the results. */
const CHILD = `
const [ledgerPath, dataPath, lockPath, countText, tag] = process.argv.slice(2);
const { LabSpendLedger, createFileLedgerStorage, createFileLock } = require(ledgerPath);
const fixed = new Date("2026-11-07T03:00:00Z");
const ledger = new LabSpendLedger(
  createFileLedgerStorage(dataPath),
  () => fixed,
  "Asia/Bangkok",
  createFileLock(lockPath, { timeoutMs: 60000, retryMs: 2 })
);
(async () => {
  const out = [];
  for (let i = 0; i < Number(countText); i++) {
    out.push(await ledger.reserve(tag + "-" + i, 350));
  }
  process.stdout.write(JSON.stringify(out));
})();
`;

function runChild(args: string[], scriptPath: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("two-process contention on temporary ledger files", () => {
  let dir: string;
  let ledgerJs: string;
  let childJs: string;

  beforeAll(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "lab-2proc-"));
    ledgerJs = await compileLedger(dir);
    childJs = path.join(dir, "child.js");
    await fsp.writeFile(childJs, CHILD, "utf8");
  });

  afterAll(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it("three processes, five reserves of 350 each: exactly two are accepted in total", async () => {
    const data = path.join(dir, "ledger-a.json");
    const lock = path.join(dir, "ledger-a.lock");
    const runs = await Promise.all(
      ["p1", "p2", "p3"].map((tag) => runChild([ledgerJs, data, lock, "5", tag], childJs))
    );
    // On failure, show each child's exit code and errors, and every result's reason.
    expect(runs.map((r) => ({ code: r.code, stderr: r.stderr.slice(0, 500) }))).toEqual(runs.map(() => ({ code: 0, stderr: "" })));
    const results = runs.flatMap((r) => JSON.parse(r.stdout) as { ok: boolean; reason?: string }[]);
    const reasons = results.reduce<Record<string, number>>((acc, r) => {
      const key = r.ok ? "ok" : String(r.reason);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    expect(reasons).toEqual({ ok: 2, day_over_cap: 13 });
    expect(results).toHaveLength(15);
    // The shared file agrees with what the processes reported.
    const state = JSON.parse(await fsp.readFile(data, "utf8"));
    expect(state.reservations.reduce((s: number, r: { credits: number }) => s + r.credits, 0)).toBe(700);
    // The lock was released by its owners.
    await expect(fsp.access(lock)).rejects.toThrow();
  }, 90_000);

  it("a held lock makes every process fail closed: no reservation is written", async () => {
    const data = path.join(dir, "ledger-b.json");
    const lock = path.join(dir, "ledger-b.lock");
    await fsp.writeFile(lock, JSON.stringify({ token: "other-live-owner", pid: 999, at: "now" }), "utf8");
    // Short timeout for this test only: the child uses 60s, so use a second child script.
    const quick = CHILD.replace("timeoutMs: 60000", "timeoutMs: 80");
    const quickJs = path.join(dir, "quick-child.js");
    await fsp.writeFile(quickJs, quick, "utf8");
    const runs = await Promise.all(["q1", "q2"].map((tag) => runChild([ledgerJs, data, lock, "2", tag], quickJs)));
    for (const r of runs) {
      expect(JSON.parse(r.stdout).every((x: { ok: boolean }) => x.ok === false)).toBe(true);
    }
    await expect(fsp.access(data)).rejects.toThrow();
    // The other owner's lock is untouched.
    expect(JSON.parse(await fsp.readFile(lock, "utf8")).token).toBe("other-live-owner");
  }, 90_000);
});
