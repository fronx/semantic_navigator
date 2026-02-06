/**
 * Test the actual API query used by /api/topics/content
 * to see if it returns content for all chunks.
 */

import { createServerClient } from '../src/lib/supabase';

async function testAPIQuery() {
  const supabase = createServerClient();

  const keyword = 'movement';
  const nodeType = 'chunk';

  console.log('=== Testing API Query for Keyword: movement ===\n');
  console.log('Query: keywords table → nodes (INNER JOIN)');
  console.log('Filter: keyword = "movement", nodes.node_type = "chunk"');
  console.log('');

  // This is the EXACT query from /api/topics/content/route.ts
  const { data, error } = await supabase
    .from('keywords')
    .select(`
      id,
      keyword,
      node_id,
      nodes!inner (
        id,
        content,
        summary,
        source_path
      )
    `)
    .in('keyword', [keyword])
    .eq('nodes.node_type', nodeType);

  if (error) {
    console.error('Query error:', error);
    return;
  }

  console.log(`\nQuery returned ${data?.length} results\n`);

  // Transform to ChunkNode format (as API does)
  const chunks = (data || []).map((kw: any) => ({
    id: kw.nodes.id,
    keywordId: `kw:${kw.keyword}`,
    content: kw.nodes.content || '',
    summary: kw.nodes.summary,
  }));

  console.log('Transformed chunks:');
  chunks.forEach((chunk, i) => {
    const id = chunk.id.substring(0, 8);
    const contentStatus = chunk.content ? `${chunk.content.length} chars` : 'EMPTY STRING';
    console.log(`  ${i + 1}. ${id} - content: ${contentStatus}`);
  });

  // Check which are empty
  const emptyChunks = chunks.filter(c => !c.content || c.content === '');
  if (emptyChunks.length > 0) {
    console.log(`\n⚠️  ${emptyChunks.length} chunks have empty content:`);
    emptyChunks.forEach(c => {
      console.log(`    - ${c.id.substring(0, 8)}`);
    });
  } else {
    console.log('\n✓ All chunks have non-empty content');
  }

  // Now check the raw nodes table directly
  console.log('\n\n=== Checking nodes table directly ===\n');

  const chunkIds = chunks.map(c => c.id);
  const { data: directNodes, error: directError } = await supabase
    .from('nodes')
    .select('id, content, node_type')
    .in('id', chunkIds);

  if (directError) {
    console.error('Direct query error:', directError);
    return;
  }

  console.log('Direct node lookup:');
  directNodes?.forEach((node, i) => {
    const id = node.id.substring(0, 8);
    const contentStatus = node.content ? `${node.content.length} chars` : 'NULL/EMPTY';
    console.log(`  ${i + 1}. ${id} - content: ${contentStatus}`);
  });
}

testAPIQuery().catch(console.error);
