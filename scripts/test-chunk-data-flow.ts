/**
 * Trace chunk data transformations from database to rendering.
 * Identifies where content field is lost for specific chunks.
 */

import { createServerClient } from '../src/lib/supabase';
import { createChunkNodes } from '../src/lib/content-layout';
import type { ChunkNode } from '../src/lib/content-loader';
import type { SimNode } from '../src/lib/map-renderer';
import * as d3 from 'd3-force';

// Test data: chunks from "movement" keyword
const CHUNK_IDS = [
  '036b0d16-0937-43cd-b656-8b54a7a0ab89', // Empty #1
  '044592d9-b538-4f69-a656-09fe490ab341', // Empty #2
  '086cda4b-fd26-4a55-bbff-c596192a6071', // Working #3
  'd2367338-f39d-4e52-98e2-737a16fe98a4', // Working #5
];

function logChunkStatus(label: string, chunks: any[]) {
  console.log(`\n${label}:`);
  chunks.forEach((c, i) => {
    const id = c.id.substring(0, 8);
    const hasContent = !!c.content;
    const contentLength = c.content?.length || 0;
    console.log(`  ${i + 1}. ${id} - content: ${hasContent ? `YES (${contentLength} chars)` : 'NO'}`);
  });
}

async function testDataFlow() {
  console.log('=== Testing Chunk Data Flow ===\n');

  const supabase = createServerClient();

  // ============================================================================
  // PHASE 1: Database → ChunkNode
  // ============================================================================
  console.log('PHASE 1: Database → ChunkNode');
  console.log('─'.repeat(80));

  const { data: dbChunks, error } = await supabase
    .from('nodes')
    .select('id, content, summary')
    .in('id', CHUNK_IDS);

  if (error || !dbChunks) {
    console.error('Error fetching chunks:', error);
    return;
  }

  console.log(`Fetched ${dbChunks.length} chunks from database`);
  logChunkStatus('DB chunks', dbChunks);

  // Create ChunkNode objects (as API does)
  const chunkNodes: ChunkNode[] = dbChunks.map(c => ({
    id: c.id,
    keywordId: 'kw:movement',
    content: c.content || '',
    summary: c.summary,
  }));

  logChunkStatus('ChunkNode objects', chunkNodes);

  // Assert all have content
  const allHaveContent = chunkNodes.every(c => c.content && c.content.length > 0);
  console.log(`\n✓ All ChunkNodes have content: ${allHaveContent}`);

  // ============================================================================
  // PHASE 2: ChunkNode → ChunkSimNode
  // ============================================================================
  console.log('\n\nPHASE 2: ChunkNode → ChunkSimNode');
  console.log('─'.repeat(80));

  // Create mock keyword SimNode
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

  const chunksByKeyword = new Map([['kw:movement', chunkNodes]]);
  const { chunkNodes: simChunks } = createChunkNodes(keywords, chunksByKeyword);

  console.log(`Created ${simChunks.length} ChunkSimNode objects`);
  logChunkStatus('ChunkSimNode objects', simChunks);

  // Check if ChunkSimNodes have content
  const simAllHaveContent = simChunks.every(c => c.content && c.content.length > 0);
  console.log(`\n✓ All ChunkSimNodes have content: ${simAllHaveContent}`);

  // ============================================================================
  // PHASE 3: D3 Simulation
  // ============================================================================
  console.log('\n\nPHASE 3: D3 Simulation');
  console.log('─'.repeat(80));

  // Create simulation (similar to useChunkSimulation)
  const simulation = d3.forceSimulation(simChunks)
    .force('collide', d3.forceCollide().radius(10).strength(0.8))
    .stop();

  // Check object identity
  const sameObjects = simChunks.every((orig, i) => simulation.nodes()[i] === orig);
  console.log(`Object identity preserved: ${sameObjects}`);

  // Tick simulation
  simulation.tick();

  // Get nodes after simulation
  const nodesAfterSim = simulation.nodes();
  logChunkStatus('After D3 simulation', nodesAfterSim);

  const simStillHaveContent = nodesAfterSim.every((n: any) => n.content && n.content.length > 0);
  console.log(`\n✓ All nodes still have content after simulation: ${simStillHaveContent}`);

  // ============================================================================
  // PHASE 4: Array Combination (R3FTopicsScene line 139)
  // ============================================================================
  console.log('\n\nPHASE 4: Array Combination');
  console.log('─'.repeat(80));

  const keywordSimNodes = keywords;
  const combined = [...keywordSimNodes, ...nodesAfterSim];

  console.log(`Combined array length: ${combined.length} (${keywordSimNodes.length} keywords + ${nodesAfterSim.length} chunks)`);

  const combinedChunks = combined.filter(n => n.type === 'chunk');
  logChunkStatus('After array spread', combinedChunks);

  const combinedStillHaveContent = combinedChunks.every((c: any) => c.content && c.content.length > 0);
  console.log(`\n✓ All chunks still have content after spreading: ${combinedStillHaveContent}`);

  // ============================================================================
  // PHASE 5: Content Extraction (label-overlays.ts line 452)
  // ============================================================================
  console.log('\n\nPHASE 5: Content Extraction');
  console.log('─'.repeat(80));

  const extracted = combinedChunks.map((node: any) => ({
    id: node.id.substring(0, 8),
    content: node.content,
    targetContent: node.content || node.label,
  }));

  console.log('Extracted content:');
  extracted.forEach((e, i) => {
    console.log(`  ${i + 1}. ${e.id} - targetContent: ${e.targetContent ? `YES (${e.targetContent.length} chars)` : 'NO'}`);
  });

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('\n\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  if (allHaveContent && simAllHaveContent && simStillHaveContent && combinedStillHaveContent) {
    console.log('✅ Content preserved through all transformations!');
    console.log('   The issue is likely NOT in the data flow pipeline.');
    console.log('   Check: React portal rendering, React key collisions, or timing issues.');
  } else {
    console.log('❌ Content lost at some transformation step!');
    if (!simAllHaveContent) console.log('   ⚠️  Lost in: ChunkNode → ChunkSimNode');
    if (!simStillHaveContent) console.log('   ⚠️  Lost in: D3 Simulation');
    if (!combinedStillHaveContent) console.log('   ⚠️  Lost in: Array Combination');
  }
}

testDataFlow().catch(console.error);
