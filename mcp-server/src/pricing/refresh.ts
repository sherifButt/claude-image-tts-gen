import { getPriceTable, getStaleness } from "./load.js";

function main(): void {
  const table = getPriceTable();
  const staleness = getStaleness();

  process.stdout.write(`Pricing table:\n`);
  process.stdout.write(`  last_updated: ${staleness.lastUpdated} (${staleness.daysAgo} days ago)\n`);
  process.stdout.write(`  status:       ${staleness.isStale ? "STALE" : "fresh"} (threshold ${staleness.threshold} days)\n`);
  process.stdout.write(`  currency:     ${table.currency}\n`);
  process.stdout.write(`  models:       ${Object.keys(table.models).length}\n\n`);

  process.stdout.write(`Sources to verify (open each, compare to pricing.json):\n`);
  for (const source of table.sources) {
    process.stdout.write(`  - ${source}\n`);
  }

  process.stdout.write(`\nTo refresh:\n`);
  process.stdout.write(`  1. Open each source URL above and check current rates.\n`);
  process.stdout.write(`  2. Edit src/pricing/pricing.json (update standard/batch rates per model).\n`);
  process.stdout.write(`  3. Update last_updated to today's date (YYYY-MM-DD).\n`);
  process.stdout.write(`  4. Run npm run build to bundle the new prices into dist/.\n`);
  process.stdout.write(`  5. Run npm run pricing:refresh again to confirm last_updated changed.\n`);
}

main();
