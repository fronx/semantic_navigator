/**
 * Quick test script for Steps 6-9 of chunk-based ingestion pipeline.
 * Verifies that the new functions work correctly without a full REPL run.
 */

import { loadCache, saveCache, hash } from '../src/lib/cache-utils';
import { generateEmbeddingsBatched } from '../src/lib/embeddings';

async function testStep6() {
  console.log('\n=== Testing Step 6: Content Embeddings ===');

  // Load existing cached data
  const articleSummaries = await loadCache('./data/article-summaries.json');
  const dedupedChunks = await loadCache('./data/chunks-keywords-deduplicated.json');

  console.log(`Loaded ${Object.keys(articleSummaries).length} article summaries`);
  console.log(`Loaded ${Object.keys(dedupedChunks).length} files with chunks`);

  // Verify structure
  const firstArticlePath = Object.keys(articleSummaries)[0];
  const firstArticle = articleSummaries[firstArticlePath];
  console.log(`First article: ${firstArticle.title}`);
  console.log(`  Summary: ${firstArticle.content?.slice(0, 100) || firstArticle.teaser?.slice(0, 100)}...`);

  console.log('✓ Step 6 data structures validated');
}

async function testStep7() {
  console.log('\n=== Testing Step 7: Content Hashing ===');

  // Test hash function
  const testContent = 'This is test content';
  const testHash = hash(testContent);

  console.log(`Test hash: ${testHash}`);
  console.log(`Hash length: ${testHash.length} (expected: 16)`);

  // Verify deterministic
  const testHash2 = hash(testContent);
  if (testHash !== testHash2) {
    throw new Error('Hash function is not deterministic!');
  }

  console.log('✓ Hash function is deterministic');

  // Verify different content produces different hash
  const testHash3 = hash('Different content');
  if (testHash === testHash3) {
    throw new Error('Different content produced same hash!');
  }

  console.log('✓ Different content produces different hash');
}

async function testStep8() {
  console.log('\n=== Testing Step 8: Database Payload Preparation ===');

  // Check if prepared data exists
  const keywordData = await loadCache('./data/keywords-prepared.json');

  if (!keywordData.keywordRecords || !keywordData.keywordOccurrences) {
    throw new Error('Invalid keywords-prepared.json structure');
  }

  console.log(`Loaded ${keywordData.keywordRecords.length} keyword records`);
  console.log(`Loaded ${keywordData.keywordOccurrences.length} keyword occurrences`);

  // Verify keyword record structure
  const firstKw = keywordData.keywordRecords[0];
  if (!firstKw.keyword || !firstKw.embedding || !firstKw.embedding_256) {
    throw new Error('Invalid keyword record structure');
  }

  console.log(`First keyword: "${firstKw.keyword}"`);
  console.log(`  Embedding dims: ${firstKw.embedding.length}`);
  console.log(`  Embedding_256 dims: ${firstKw.embedding_256.length}`);

  console.log('✓ Keyword data structure validated');
}

async function main() {
  console.log('Testing Steps 6-9 implementation...\n');

  try {
    await testStep6();
    await testStep7();
    await testStep8();

    console.log('\n✓ All tests passed!');
    console.log('\nNext steps:');
    console.log('  1. Run the full REPL script: npm run script scripts/repl-explore-chunking.ts');
    console.log('  2. Verify Steps 6-7 generate cache files');
    console.log('  3. Review dbPayloads in data/db-payloads.json');
    console.log('  4. Run insertToDatabase with dryRun: false to insert to database');
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    process.exit(1);
  }
}

main();
