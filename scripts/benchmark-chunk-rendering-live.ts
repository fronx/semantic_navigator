/**
 * Performance benchmark using live data from database
 *
 * Tests chunk loading and rendering with real keyword/chunk data
 *
 * Run with: npm run script scripts/benchmark-chunk-rendering-live.ts
 */

import { createServerClient } from '@/lib/supabase';
import { calculateScales } from '@/lib/content-scale';

interface ChunkData {
  id: string;
  keyword: string;
  node_id: string;
  nodes: {
    id: string;
    content: string;
    summary: string | null;
  };
}

async function fetchLiveChunkData(limit: number = 100) {
  console.log(`Fetching up to ${limit} chunk records from database...`);
  const supabase = createServerClient();

  const { data: keywords, error: keywordsError } = await supabase
    .from('keywords')
    .select('id, keyword, node_id')
    .limit(limit);

  if (keywordsError) {
    throw new Error(`Failed to fetch keywords: ${keywordsError.message}`);
  }

  console.log(`  Fetched ${keywords?.length ?? 0} keywords`);

  // Get unique keyword labels
  const keywordLabels = [...new Set(keywords?.map(k => k.keyword) ?? [])];
  console.log(`  Unique keyword labels: ${keywordLabels.length}`);

  // Fetch chunks for these keywords
  const { data: chunks, error: chunksError } = await supabase
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
    .in('keyword', keywordLabels.slice(0, 50)) // Limit to first 50 unique keywords
    .eq('nodes.node_type', 'chunk');

  if (chunksError) {
    throw new Error(`Failed to fetch chunks: ${chunksError.message}`);
  }

  console.log(`  Fetched ${chunks?.length ?? 0} chunks`);
  return chunks as ChunkData[];
}

function benchmarkChunkDataProcessing(chunks: ChunkData[], iterations: number) {
  console.log(`\nBenchmarking chunk data processing (${iterations} iterations)...`);

  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    // Simulate what happens in createChunkNodes
    const chunkNodes = chunks.map(chunk => ({
      id: chunk.nodes.id,
      keywordId: `kw:${chunk.keyword}`,
      type: 'chunk' as const,
      label: chunk.nodes.summary || chunk.nodes.content.slice(0, 50) + '...',
      size: chunk.nodes.content.length,
      scale: 0.0,
      x: Math.random() * 1000,
      y: Math.random() * 1000,
      z: -150,
    }));

    // Simulate scale updates
    const scales = calculateScales(5000);
    for (const node of chunkNodes) {
      node.scale = scales.contentScale;
    }
  }

  const end = performance.now();
  const totalTime = end - start;
  const avgTime = totalTime / iterations;

  console.log(`  Total time: ${totalTime.toFixed(2)} ms`);
  console.log(`  Average time per iteration: ${avgTime.toFixed(4)} ms`);
  console.log(`  Operations/sec: ${((iterations / totalTime) * 1000).toFixed(0)}`);

  return { avgTime, totalTime };
}

function analyzeChunkData(chunks: ChunkData[]) {
  console.log('\n--- Chunk Data Analysis ---');

  // Group by keyword
  const chunksByKeyword = new Map<string, ChunkData[]>();
  for (const chunk of chunks) {
    const existing = chunksByKeyword.get(chunk.keyword) || [];
    chunksByKeyword.set(chunk.keyword, [...existing, chunk]);
  }

  console.log(`Total chunks: ${chunks.length}`);
  console.log(`Unique keywords: ${chunksByKeyword.size}`);
  console.log(`Chunks per keyword (avg): ${(chunks.length / chunksByKeyword.size).toFixed(2)}`);

  // Content size statistics
  const contentLengths = chunks.map(c => c.nodes.content.length);
  const avgContentLength = contentLengths.reduce((a, b) => a + b, 0) / contentLengths.length;
  const maxContentLength = Math.max(...contentLengths);
  const minContentLength = Math.min(...contentLengths);

  console.log(`Content length (avg): ${avgContentLength.toFixed(0)} chars`);
  console.log(`Content length (min/max): ${minContentLength} / ${maxContentLength} chars`);

  // Memory estimate
  const totalContentBytes = contentLengths.reduce((a, b) => a + b, 0) * 2; // UTF-16
  console.log(`Estimated memory for content: ${(totalContentBytes / 1024 / 1024).toFixed(2)} MB`);
}

async function main() {
  console.log('=== Chunk Rendering Performance (Live Data) ===\n');

  try {
    // Fetch live data
    const chunks = await fetchLiveChunkData(100);

    if (!chunks || chunks.length === 0) {
      console.log('No chunk data found. Make sure chunks exist in the database.');
      return;
    }

    // Analyze the data
    analyzeChunkData(chunks);

    // Benchmark processing
    const results = benchmarkChunkDataProcessing(chunks, 1000);

    // Performance analysis
    console.log('\n--- Performance Analysis ---');
    console.log(`Target: 60 FPS = 16.67ms per frame`);
    console.log(`Budget for chunk updates: ~2-3ms per frame`);

    if (results.avgTime < 3) {
      console.log('✅ Performance is good - updates fit within frame budget');
    } else if (results.avgTime < 5) {
      console.log('⚠️  Performance is marginal - may cause frame drops');
    } else {
      console.log('❌ Performance is poor - will cause significant frame drops');
      console.log(`   Current time: ${results.avgTime.toFixed(2)}ms`);
      console.log(`   Target time: <3ms`);
      console.log(`   Slowdown factor: ${(results.avgTime / 3).toFixed(1)}x`);
    }

    console.log('\n=== Benchmark Complete ===');
  } catch (error) {
    console.error('Benchmark failed:', error);
    throw error;
  }
}

main().catch(console.error);
