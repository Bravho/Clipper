/**
 * Load .env.local into process.env BEFORE any module that reads env at import
 * time (notably `src/lib/db.ts`, which builds the pg Pool from PG* vars when it
 * is first imported). Next.js loads .env.local automatically for the web app;
 * standalone scripts (the render worker) do not, so we do it here.
 *
 * IMPORTANT: import THIS module first in any standalone entrypoint. ES modules
 * execute imported modules' top-level code in source order, so a leading
 * `import "./bootstrapEnv"` runs before `import "@/repositories/index"`.
 */
import { config } from "dotenv";
import * as path from "path";

config({ path: path.join(process.cwd(), ".env.local") });
