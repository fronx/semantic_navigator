/**
 * Test script for debugging the /api/topics/chunks endpoint
 *
 * Run with: npm run script scripts/test-chunks-api.ts
 */

import { createServerClient } from '@/lib/supabase';

async function main() {
  console.log('=== Testing Chunks API ===\n');

  const supabase = createServerClient();

  // Step 1: Check what keywords exist in the database
  console.log('Step 1: Checking keywords table...');
  const { data: sampleKeywords, error: keywordsError } = await supabase
    .from('keywords')
    .select('id, keyword, node_id')
    .limit(10);

  if (keywordsError) {
    console.error('Error querying keywords:', keywordsError);
    return;
  }

  console.log(`Found ${sampleKeywords?.length ?? 0} sample keywords:`);
  sampleKeywords?.forEach((kw, i) => {
    console.log(`  ${i + 1}. "${kw.keyword}" (node_id: ${kw.node_id?.substring(0, 8)}...)`);
  });

  // Step 2: Check what node types exist
  console.log('\nStep 2: Checking node types...');
  const { data: nodeTypes, error: nodeTypesError } = await supabase
    .from('nodes')
    .select('node_type')
    .limit(1000);

  if (nodeTypesError) {
    console.error('Error querying nodes:', nodeTypesError);
    return;
  }

  const typeCounts = new Map<string, number>();
  nodeTypes?.forEach(n => {
    typeCounts.set(n.node_type, (typeCounts.get(n.node_type) ?? 0) + 1);
  });

  console.log('Node type distribution:');
  typeCounts.forEach((count, type) => {
    console.log(`  ${type}: ${count}`);
  });

  // Step 3: Try the join query with a sample keyword
  if (sampleKeywords && sampleKeywords.length > 0) {
    const testKeyword = sampleKeywords[0].keyword;
    console.log(`\nStep 3: Testing join query with keyword "${testKeyword}"...`);

    const { data: joinResult, error: joinError } = await supabase
      .from('keywords')
      .select(`
        id,
        keyword,
        node_id,
        nodes!inner (
          id,
          node_type,
          content,
          summary
        )
      `)
      .eq('keyword', testKeyword);

    if (joinError) {
      console.error('Error with join:', joinError);
    } else {
      console.log(`Join returned ${joinResult?.length ?? 0} results`);
      if (joinResult && joinResult.length > 0) {
        const result = joinResult[0] as any;
        console.log('  Result:', {
          keyword: result.keyword,
          node_type: result.nodes?.node_type,
          has_content: !!result.nodes?.content,
          content_length: result.nodes?.content?.length ?? 0,
        });
      }
    }

    // Step 4: Try with chunk filter
    console.log(`\nStep 4: Testing with node_type = 'chunk' filter...`);
    const { data: chunkResult, error: chunkError } = await supabase
      .from('keywords')
      .select(`
        id,
        keyword,
        node_id,
        nodes!inner (
          id,
          node_type,
          content,
          summary
        )
      `)
      .eq('keyword', testKeyword)
      .eq('nodes.node_type', 'chunk');

    if (chunkError) {
      console.error('Error with chunk filter:', chunkError);
    } else {
      console.log(`Chunk filter returned ${chunkResult?.length ?? 0} results`);
      if (chunkResult && chunkResult.length > 0) {
        const result = chunkResult[0] as any;
        console.log('  Result:', {
          keyword: result.keyword,
          node_type: result.nodes?.node_type,
          has_content: !!result.nodes?.content,
          content_length: result.nodes?.content?.length ?? 0,
          content_preview: result.nodes?.content?.slice(0, 100),
        });
      }
    }
  }

  // Step 5: Test with multiple keywords (like the API does)
  console.log('\nStep 5: Testing batch query with first 5 keywords...');
  const testKeywordLabels = sampleKeywords?.slice(0, 5).map(kw => kw.keyword) ?? [];
  console.log('  Keywords:', testKeywordLabels);

  const { data: batchResult, error: batchError } = await supabase
    .from('keywords')
    .select(`
      id,
      keyword,
      node_id,
      nodes!inner (
        id,
        content,
        summary
      )
    `)
    .in('keyword', testKeywordLabels)
    .eq('nodes.node_type', 'chunk');

  if (batchError) {
    console.error('Batch query error:', batchError);
  } else {
    console.log(`Batch query returned ${batchResult?.length ?? 0} results`);
    if (batchResult && batchResult.length > 0) {
      console.log(`  First result: keyword="${(batchResult[0] as any).keyword}", has_content=${!!(batchResult[0] as any).nodes?.content}`);
    }
  }

  console.log('\n=== Test Complete ===');
}

main().catch(console.error);
