/**
 * Test if ChunkSimNode content property is accessible through type casting.
 * This simulates the exact pattern used in label-overlays.ts.
 */

import { createServerClient } from '../src/lib/supabase';
import { createChunkNodes } from '../src/lib/content-layout';
import type { ChunkNode } from '../src/lib/content-loader';
import type { SimNode } from '../src/lib/map-renderer';
import type { ChunkSimNode } from '../src/lib/content-layout';

const CHUNK_IDS = [
  '036b0d16-0937-43cd-b656-8b54a7a0ab89', // Should be empty in UI
  '044592d9-b538-4f69-a656-09fe490ab341', // Should be empty in UI
  '086cda4b-fd26-4a55-bbff-c596192a6071', // Should work in UI
];

async function testNodeContentAccess() {
  console.log('=== Testing SimNode Content Property Access ===\n');

  const supabase = createServerClient();

  // Fetch chunks
  const { data: dbChunks, error } = await supabase
    .from('nodes')
    .select('id, content, summary')
    .in('id', CHUNK_IDS);

  if (error || !dbChunks) {
    console.error('Error:', error);
    return;
  }

  // Create ChunkNode objects
  const chunkNodes: ChunkNode[] = dbChunks.map(c => ({
    id: c.id,
    keywordId: 'kw:movement',
    content: c.content || '',
    summary: c.summary,
  }));

  // Create mock keyword
  const keywords: SimNode[] = [{
    id: 'kw:movement',
    type: 'keyword' as const,
    label: 'movement',
    x: 0,
    y: 0,
    communityId: undefined,
    embedding: undefined,
    communityMembers: undefined,
    hullLabel: undefined,
  }];

  // Create ChunkSimNodes
  const { chunkNodes: simChunks } = createChunkNodes(keywords, new Map([['kw:movement', chunkNodes]]));

  // Combine with keywords (as R3FTopicsScene does)
  const combined: SimNode[] = [...keywords, ...simChunks];

  console.log('Combined array contains:');
  console.log(`  - ${keywords.length} keyword nodes`);
  console.log(`  - ${simChunks.length} chunk nodes`);
  console.log(`  - Total: ${combined.length} nodes\n`);

  // Now simulate updateChunkLabels iteration
  console.log('Simulating updateChunkLabels iteration:');
  console.log('─'.repeat(80));

  for (const node of combined) {
    if (node.type !== 'chunk') continue;

    // This is the EXACT pattern from label-overlays.ts line 452
    const targetContent = (node as ChunkSimNode).content || node.label;

    // Also check if we can access content directly
    const directAccess = (node as any).content;
    const hasOwnProperty = node.hasOwnProperty('content');
    const inNode = 'content' in node;

    const id = node.id.substring(0, 8);
    console.log(`\nChunk ${id}:`);
    console.log(`  node.type: ${node.type}`);
    console.log(`  node.label: "${node.label.substring(0, 50)}..."`);
    console.log(`  (node as ChunkSimNode).content: ${directAccess ? `${directAccess.length} chars` : 'UNDEFINED/FALSY'}`);
    console.log(`  hasOwnProperty('content'): ${hasOwnProperty}`);
    console.log(`  'content' in node: ${inNode}`);
    console.log(`  targetContent: ${targetContent ? `${targetContent.length} chars` : 'UNDEFINED/FALSY'}`);

    // Check all properties on the node
    const nodeKeys = Object.keys(node);
    const hasContentKey = nodeKeys.includes('content');
    console.log(`  Object.keys includes 'content': ${hasContentKey}`);
    if (!hasContentKey) {
      console.log(`  Available keys: ${nodeKeys.join(', ')}`);
    }
  }

  // ============================================================================
  // Check if the issue is with array spreading
  // ============================================================================
  console.log('\n\n' + '='.repeat(80));
  console.log('Testing if array spreading loses properties:');
  console.log('='.repeat(80));

  console.log('\nOriginal simChunks[0] properties:');
  const originalChunk = simChunks[0];
  console.log(`  Has content: ${'content' in originalChunk}`);
  console.log(`  Content value: ${originalChunk.content ? `${originalChunk.content.length} chars` : 'MISSING'}`);

  console.log('\nAfter spreading into combined array:');
  const chunkFromCombined = combined.find(n => n.type === 'chunk' && n.id === originalChunk.id);
  if (chunkFromCombined) {
    console.log(`  Same object reference: ${chunkFromCombined === originalChunk}`);
    console.log(`  Has content: ${'content' in chunkFromCombined}`);
    console.log(`  Content value: ${(chunkFromCombined as any).content ? `${(chunkFromCombined as any).content.length} chars` : 'MISSING'}`);
  }
}

testNodeContentAccess().catch(console.error);
