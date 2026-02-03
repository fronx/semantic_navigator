/**
 * Test the actual /api/topics/chunks endpoint
 *
 * Run with: npm run script scripts/test-api-endpoint.ts
 */

async function main() {
  console.log('=== Testing /api/topics/chunks endpoint ===\n');

  // Test with some keyword IDs that we know link to chunks
  const testKeywordIds = [
    'kw:agency',
    'kw:thought visualization',
    'kw:temporal structure',
  ];

  console.log('Sending request with keyword IDs:', testKeywordIds);

  const response = await fetch('http://localhost:3000/api/topics/chunks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywordIds: testKeywordIds }),
  });

  if (!response.ok) {
    console.error('Response not OK:', response.status, response.statusText);
    const text = await response.text();
    console.error('Response body:', text);
    return;
  }

  const data = await response.json();
  console.log('\nResponse:', {
    chunkCount: data.chunks?.length ?? 0,
  });

  if (data.chunks && data.chunks.length > 0) {
    console.log('\nFirst 3 chunks:');
    data.chunks.slice(0, 3).forEach((chunk: any, i: number) => {
      console.log(`  ${i + 1}. keywordId: ${chunk.keywordId}`);
      console.log(`     has_content: ${!!chunk.content}`);
      console.log(`     content_length: ${chunk.content?.length ?? 0}`);
      console.log(`     content_preview: ${chunk.content?.slice(0, 80)}...`);
      console.log('');
    });
  }

  console.log('=== Test Complete ===');
}

main().catch(console.error);
