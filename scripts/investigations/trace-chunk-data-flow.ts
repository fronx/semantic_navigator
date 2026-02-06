import { createServerClient } from '../src/lib/supabase';

const CHUNK_ID = '8483bee6-b4c4-470f-873f-41e2d709695f';
const KEYWORD = 'wave dynamics';

async function traceDataFlow() {
  const supabase = createServerClient();

  console.log('=== TRACING DATA FLOW FOR CHUNK ===');
  console.log('Chunk ID:', CHUNK_ID);
  console.log('Keyword:', KEYWORD);
  console.log('');

  // Step 1: Check the chunk node
  const { data: chunk, error: chunkError } = await supabase
    .from('nodes')
    .select('id, node_type, content, summary')
    .eq('id', CHUNK_ID)
    .single();

  if (chunkError) {
    console.error('Error fetching chunk:', chunkError);
    return;
  }

  console.log('Step 1: Chunk node in database');
  console.log('  - node_type:', chunk.node_type);
  console.log('  - content:', chunk.content ? `"${chunk.content}"` : 'NULL');
  console.log('  - content length:', chunk.content?.length ?? 0);
  console.log('  - summary:', chunk.summary ? `"${chunk.summary.substring(0, 50)}..."` : 'NULL');
  console.log('');

  // Step 2: Check keywords table for this chunk
  const { data: keywords, error: kwError } = await supabase
    .from('keywords')
    .select('id, keyword, node_id, node_type')
    .eq('node_id', CHUNK_ID);

  if (kwError) {
    console.error('Error fetching keywords:', kwError);
    return;
  }

  console.log('Step 2: Keywords associated with this chunk');
  keywords?.forEach(kw => {
    console.log(`  - "${kw.keyword}" (node_type: ${kw.node_type})`);
  });
  console.log('');

  // Step 3: Simulate the API query for "wave dynamics"
  console.log('Step 3: Simulating API query for keyword "wave dynamics"');
  const { data: apiResult, error: apiError } = await supabase
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
    .in('keyword', [KEYWORD])
    .eq('nodes.node_type', 'chunk');

  if (apiError) {
    console.error('Error in API simulation:', apiError);
    return;
  }

  console.log(`Found ${apiResult?.length ?? 0} results`);
  const ourChunk = apiResult?.find((kw: any) => kw.nodes.id === CHUNK_ID);

  if (ourChunk) {
    console.log('✓ Our chunk IS in the results');
    console.log('  - keyword:', ourChunk.keyword);
    console.log('  - node_id:', ourChunk.node_id);
    console.log('  - nodes.id:', ourChunk.nodes.id);
    console.log('  - nodes.content:', ourChunk.nodes.content ? `"${ourChunk.nodes.content}"` : 'NULL');
    console.log('  - nodes.summary:', ourChunk.nodes.summary ? `"${ourChunk.nodes.summary.substring(0, 50)}..."` : 'NULL');
  } else {
    console.log('✗ Our chunk is NOT in the results');
    console.log('');
    console.log('Results that were returned:');
    apiResult?.forEach((kw: any, i: number) => {
      console.log(`  ${i + 1}. Chunk ${kw.nodes.id}`);
      console.log(`     Content: ${kw.nodes.content ? `"${kw.nodes.content.substring(0, 60)}..."` : 'NULL'}`);
    });
  }
  console.log('');

  // Step 4: Check what the transformed API response would be
  console.log('Step 4: Transformed API response');
  const transformedChunks = (apiResult || []).map((kw: any) => ({
    id: kw.nodes.id,
    keywordId: `kw:${kw.keyword}`,
    content: kw.nodes.content || '',
    summary: kw.nodes.summary,
  }));

  const transformedOurChunk = transformedChunks.find((c: any) => c.id === CHUNK_ID);
  if (transformedOurChunk) {
    console.log('✓ Our chunk in transformed response:');
    console.log('  - id:', transformedOurChunk.id);
    console.log('  - keywordId:', transformedOurChunk.keywordId);
    console.log('  - content:', transformedOurChunk.content ? `"${transformedOurChunk.content}"` : '(empty string)');
    console.log('  - content.length:', transformedOurChunk.content.length);
  } else {
    console.log('✗ Our chunk NOT in transformed response');
  }
}

traceDataFlow().catch(console.error);
