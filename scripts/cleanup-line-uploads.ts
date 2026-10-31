// Scheduled entry point. Dry-run unless --execute is explicitly supplied. Do not run during development.
import { spacesClient, SPACES_BUCKET } from '../src/lib/spaces';
import { cleanupLineAssets } from '../src/services/line/cleanupLineAssets';
async function main() {
  const result = await cleanupLineAssets(spacesClient, SPACES_BUCKET, { execute: process.argv.includes('--execute') });
  console.log(JSON.stringify(result));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
