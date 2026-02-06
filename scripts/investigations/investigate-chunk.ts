import { createServerClient } from '../src/lib/supabase';

const CHUNK_ID = '8483bee6-b4c4-470f-873f-41e2d709695f';

async function investigateChunk() {
  const supabase = createServerClient();

  // Get the problematic chunk
  const { data: chunk, error } = await supabase
    .from('nodes')
    .select('*')
    .eq('id', CHUNK_ID)
    .single();

  if (error) {
    console.error('Error fetching chunk:', error);
    return;
  }

  console.log('=== PROBLEMATIC CHUNK ===');
  console.log('ID:', chunk.id);
  console.log('Title:', chunk.title);
  console.log('Node type:', chunk.node_type);
  console.log('Content length:', chunk.content?.length ?? 'NULL');
  console.log('Content preview:', chunk.content?.substring(0, 200));
  console.log('Summary:', chunk.summary);
  console.log('Chunk type:', chunk.chunk_type);
  console.log('Heading context:', chunk.heading_context);
  console.log('Created at:', chunk.created_at);
  console.log('\nFull content:\n', chunk.content);

  // Get some comparison chunks that have content
  const { data: comparisonChunks, error: compError } = await supabase
    .from('nodes')
    .select('id, title, node_type, content, summary, chunk_type')
    .eq('node_type', 'chunk')
    .not('content', 'is', null)
    .limit(5);

  if (compError) {
    console.error('Error fetching comparison chunks:', compError);
    return;
  }

  console.log('\n\n=== COMPARISON CHUNKS (for reference) ===');
  comparisonChunks?.forEach((c, i) => {
    console.log(`\n--- Chunk ${i + 1} ---`);
    console.log('ID:', c.id);
    console.log('Title:', c.title);
    console.log('Content length:', c.content?.length);
    console.log('Content preview:', c.content?.substring(0, 100));
    console.log('Chunk type:', c.chunk_type);
  });

  // Check if there are keywords associated with this chunk
  const { data: keywords, error: kwError } = await supabase
    .from('keywords')
    .select('keyword, node_id, node_type')
    .eq('node_id', CHUNK_ID);

  if (kwError) {
    console.error('Error fetching keywords:', kwError);
    return;
  }

  console.log('\n\n=== KEYWORDS FOR THIS CHUNK ===');
  console.log('Keywords:', keywords?.map(k => k.keyword).join(', '));
}

investigateChunk().catch(console.error);
