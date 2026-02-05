import { createServerClient } from '../src/lib/supabase';

// Both example cases from user screenshots
const EXAMPLE_1_CHUNKS = ['8483bee6-b4c4-470f-873f-41e2d709695f'];
const EXAMPLE_2_CHUNKS = [
  '036b0d16-0937-43cd-b656-8b54a7a0ab89',
  '044592d9-b538-4f69-a656-09fe490ab341',
  '086cda4b-fd26-4a55-bbff-c596192a6071',
  'b1762308-268d-44fc-b12e-aca0c714cb88',
  'd2367338-f39d-4e52-98e2-737a16fe98a4',
];

const ALL_CHUNKS = [...EXAMPLE_1_CHUNKS, ...EXAMPLE_2_CHUNKS];

async function analyzeChunks() {
  const supabase = createServerClient();

  console.log('=== ANALYZING CHUNKS FOR PATTERNS ===\n');

  // Fetch all chunks
  const { data: chunks, error } = await supabase
    .from('nodes')
    .select('id, content, summary, chunk_type, heading_context')
    .in('id', ALL_CHUNKS);

  if (error) {
    console.error('Error fetching chunks:', error);
    return;
  }

  console.log(`Found ${chunks?.length} chunks\n`);

  // Analyze each chunk
  for (const chunk of chunks || []) {
    console.log('─'.repeat(80));
    console.log(`Chunk ID: ${chunk.id}`);
    console.log(`Chunk type: ${chunk.chunk_type || 'NULL'}`);
    console.log(`Heading context: ${chunk.heading_context || 'NULL'}`);
    console.log(`Summary: ${chunk.summary ? `"${chunk.summary.substring(0, 50)}..."` : 'NULL'}`);
    console.log(`Content length: ${chunk.content?.length || 0}`);

    if (chunk.content) {
      // Check for special characters
      const hasNewlines = chunk.content.includes('\n');
      const hasQuotes = chunk.content.includes('"') || chunk.content.includes("'");
      const hasBrackets = chunk.content.includes('[') || chunk.content.includes(']');
      const hasBackticks = chunk.content.includes('`');
      const hasMarkdown = chunk.content.match(/[*_#\-]/);
      const startsWithWhitespace = /^\s/.test(chunk.content);
      const endsWithWhitespace = /\s$/.test(chunk.content);

      console.log(`Special chars: newlines=${hasNewlines}, quotes=${hasQuotes}, brackets=${hasBrackets}, backticks=${hasBackticks}, markdown=${!!hasMarkdown}`);
      console.log(`Whitespace: starts=${startsWithWhitespace}, ends=${endsWithWhitespace}`);
      console.log(`First 100 chars: "${chunk.content.substring(0, 100).replace(/\n/g, '\\n')}"`);

      // Check if content is just whitespace
      if (chunk.content.trim().length === 0) {
        console.log('⚠️  WARNING: Content is all whitespace!');
      }
    } else {
      console.log('❌ Content is NULL or undefined');
    }

    console.log('');
  }

  // Summary statistics
  console.log('\n=== SUMMARY STATISTICS ===');
  const contentLengths = chunks?.map(c => c.content?.length || 0) || [];
  const avgLength = contentLengths.reduce((a, b) => a + b, 0) / contentLengths.length;
  const minLength = Math.min(...contentLengths);
  const maxLength = Math.max(...contentLengths);

  console.log(`Content length: min=${minLength}, max=${maxLength}, avg=${avgLength.toFixed(0)}`);
  console.log(`Chunks with no content: ${chunks?.filter(c => !c.content || c.content.trim().length === 0).length || 0}`);
  console.log(`Chunks with summary: ${chunks?.filter(c => c.summary).length || 0}`);
  console.log(`Chunks with chunk_type: ${chunks?.filter(c => c.chunk_type).length || 0}`);

  // Check for unique patterns
  const chunkTypes = new Set(chunks?.map(c => c.chunk_type).filter(Boolean));
  console.log(`Unique chunk types: ${Array.from(chunkTypes).join(', ')}`);
}

analyzeChunks().catch(console.error);
