/**
 * Test if Map iteration order could cause first N entries to behave differently.
 * Specifically testing the chunksByKeyword Map structure.
 */

import { createServerClient } from '../src/lib/supabase';
import type { ContentNode } from '../src/lib/content-loader';

async function testMapIterationOrder() {
  console.log('=== Testing Map Iteration Order ===\n');

  const supabase = createServerClient();

  // Fetch chunks for "movement" keyword (using same query as API)
  const { data, error } = await supabase
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
    .in('keyword', ['movement'])
    .eq('nodes.node_type', 'chunk');

  if (error || !data) {
    console.error('Error:', error);
    return;
  }

  console.log(`Query returned ${data.length} keyword-chunk associations\n`);

  // Transform to ContentNode objects (as API does)
  const chunks: ContentNode[] = data.map((kw: any) => ({
    id: kw.nodes.id,
    keywordId: `kw:${kw.keyword}`,
    content: kw.nodes.content || '',
    summary: kw.nodes.summary,
  }));

  console.log('Chunks in array order:');
  chunks.forEach((c, i) => {
    const id = c.id.substring(0, 8);
    const contentLen = c.content.length;
    console.log(`  ${i + 1}. ${id} - ${contentLen} chars`);
  });

  // Create Map (as useChunkLoading does)
  const chunksByKeyword = new Map<string, ContentNode[]>();
  chunksByKeyword.set('kw:movement', chunks);

  console.log('\n\nIterating over Map:');
  for (const [keywordId, keywordChunks] of chunksByKeyword) {
    console.log(`Keyword: ${keywordId}`);
    keywordChunks.forEach((c, i) => {
      const id = c.id.substring(0, 8);
      const contentLen = c.content.length;
      console.log(`  ${i + 1}. ${id} - ${contentLen} chars`);
    });
  }

  // Check if the problematic chunks are first in the array
  const problemChunkIds = [
    '036b0d16-0937-43cd-b656-8b54a7a0ab89',
    '044592d9-b538-4f69-a656-09fe490ab341',
  ];

  console.log('\n\nProblem chunk positions:');
  problemChunkIds.forEach(id => {
    const index = chunks.findIndex(c => c.id === id);
    console.log(`  ${id.substring(0, 8)}: position ${index + 1}/${chunks.length}`);
  });

  // ============================================================================
  // Test if creating the Map multiple times changes order
  // ============================================================================
  console.log('\n\n' + '='.repeat(80));
  console.log('Testing Map creation stability:');
  console.log('='.repeat(80));

  const map1 = new Map<string, ContentNode[]>();
  map1.set('kw:movement', chunks);

  const map2 = new Map<string, ContentNode[]>();
  map2.set('kw:movement', chunks);

  const map3 = new Map<string, ContentNode[]>();
  map3.set('kw:movement', [...chunks]); // spread array

  console.log('\nMap 1 first chunk:', map1.get('kw:movement')?.[0]?.id.substring(0, 8));
  console.log('Map 2 first chunk:', map2.get('kw:movement')?.[0]?.id.substring(0, 8));
  console.log('Map 3 first chunk (spread):', map3.get('kw:movement')?.[0]?.id.substring(0, 8));

  console.log('\nAll same? ',
    map1.get('kw:movement')?.[0]?.id === map2.get('kw:movement')?.[0]?.id &&
    map2.get('kw:movement')?.[0]?.id === map3.get('kw:movement')?.[0]?.id
  );

  // ============================================================================
  // Check if React state updates could cause stale references
  // ============================================================================
  console.log('\n\n' + '='.repeat(80));
  console.log('Simulating React state updates:');
  console.log('='.repeat(80));

  // Initial state (empty)
  let stateMap = new Map<string, ContentNode[]>();
  console.log('\n1. Initial state: empty Map');
  console.log(`   Size: ${stateMap.size}`);

  // First update: add chunks
  stateMap = new Map(stateMap);
  stateMap.set('kw:movement', chunks);
  console.log('\n2. After first update: chunks added');
  console.log(`   Size: ${stateMap.size}`);
  console.log(`   Chunks: ${stateMap.get('kw:movement')?.length}`);

  // Second update: same chunks (simulating re-fetch with same data)
  const prevMap = stateMap;
  stateMap = new Map(stateMap);
  stateMap.set('kw:movement', chunks);
  console.log('\n3. After second update: same chunks');
  console.log(`   Maps are different objects: ${prevMap !== stateMap}`);
  console.log(`   Arrays are same reference: ${prevMap.get('kw:movement') === stateMap.get('kw:movement')}`);

  console.log('\n\nConclusion: Map and array iteration order is stable.');
  console.log('The issue is NOT related to Map iteration order.');
}

testMapIterationOrder().catch(console.error);
