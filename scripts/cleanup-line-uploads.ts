// Scheduled entry point. Dry-run unless --execute is explicitly supplied. Do not run during development.
import { spacesClient, SPACES_BUCKET } from '../src/lib/spaces';
import { cleanupLineAssets } from '../src/services/line/cleanupLineAssets';
import { assetVisualAnalysisRepository } from '../src/repositories';
async function main() {
  const result = await cleanupLineAssets(spacesClient, SPACES_BUCKET, {
    execute: process.argv.includes('--execute'),
    analysisRepo: assetVisualAnalysisRepository,
  });
  console.log(JSON.stringify(result));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
