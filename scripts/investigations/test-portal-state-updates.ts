/**
 * Simulate the React portal state update flow to identify
 * if there's an issue with how chunkPortals Map is updated.
 */

// Simulate the handleChunkLabelContainer callback from LabelsOverlay.tsx
function simulatePortalStateUpdate() {
  console.log('=== Simulating Portal State Updates ===\n');

  // Initial state (empty Map)
  let chunkPortals = new Map<string, { container: any; content: string }>();

  // Simulate creating containers (simplified)
  const mockContainer1 = { id: 'container1' };
  const mockContainer2 = { id: 'container2' };
  const mockContainer3 = { id: 'container3' };

  // Test data
  const chunks = [
    { id: 'chunk1', content: 'Content for chunk 1' },
    { id: 'chunk2', content: 'Content for chunk 2' },
    { id: 'chunk3', content: 'Content for chunk 3' },
  ];

  console.log('Test 1: Normal content strings');
  console.log('─'.repeat(80));

  // Simulate handleChunkLabelContainer being called for each chunk
  chunks.forEach((chunk, i) => {
    const container = [mockContainer1, mockContainer2, mockContainer3][i];
    const visible = true;
    const content = chunk.content;

    console.log(`Calling handleChunkLabelContainer for ${chunk.id}`);
    console.log(`  visible: ${visible}, content: ${content ? `"${content}"` : 'FALSY'}`);
    console.log(`  Check (visible && content): ${!!(visible && content)}`);

    // This is the EXACT logic from LabelsOverlay.tsx line 62-70
    const next = new Map(chunkPortals);
    if (visible && content) {
      next.set(chunk.id, { container, content });
      console.log(`  ✓ Portal added`);
    } else {
      next.delete(chunk.id);
      console.log(`  ✗ Portal NOT added (check failed)`);
    }
    chunkPortals = next;
  });

  console.log(`\nResult: ${chunkPortals.size} portals in Map`);
  console.log('Portal IDs:', Array.from(chunkPortals.keys()));

  // ============================================================================
  // Test 2: Empty string content (the suspected issue)
  // ============================================================================
  console.log('\n\nTest 2: Empty string content');
  console.log('─'.repeat(80));

  chunkPortals = new Map();

  const emptyChunks = [
    { id: 'chunk1', content: '' },
    { id: 'chunk2', content: '' },
    { id: 'chunk3', content: 'Content for chunk 3' },
  ];

  emptyChunks.forEach((chunk, i) => {
    const container = [mockContainer1, mockContainer2, mockContainer3][i];
    const visible = true;
    const content = chunk.content;

    console.log(`Calling handleChunkLabelContainer for ${chunk.id}`);
    console.log(`  visible: ${visible}, content: ${content ? `"${content}"` : 'EMPTY STRING'}`);
    console.log(`  content === "": ${content === ''}`);
    console.log(`  Check (visible && content): ${!!(visible && content)}`);

    const next = new Map(chunkPortals);
    if (visible && content) {
      next.set(chunk.id, { container, content });
      console.log(`  ✓ Portal added`);
    } else {
      next.delete(chunk.id);
      console.log(`  ✗ Portal NOT added (check failed)`);
    }
    chunkPortals = next;
  });

  console.log(`\nResult: ${chunkPortals.size} portals in Map`);
  console.log('Portal IDs:', Array.from(chunkPortals.keys()));

  // ============================================================================
  // Test 3: Check if label extraction could produce empty strings
  // ============================================================================
  console.log('\n\nTest 3: Label extraction with missing content field');
  console.log('─'.repeat(80));

  const nodesWithMissingContent = [
    { id: 'chunk1', type: 'chunk', label: 'Label 1' }, // No content field
    { id: 'chunk2', type: 'chunk', label: 'Label 2', content: undefined }, // undefined
    { id: 'chunk3', type: 'chunk', label: 'Label 3', content: null }, // null
    { id: 'chunk4', type: 'chunk', label: 'Label 4', content: '' }, // empty string
    { id: 'chunk5', type: 'chunk', label: 'Label 5', content: 'Real content' }, // valid
  ];

  nodesWithMissingContent.forEach(node => {
    // This is the EXACT logic from label-overlays.ts line 452
    const targetContent = (node as any).content || node.label;

    console.log(`${node.id}:`);
    console.log(`  node.content: ${node.content === undefined ? 'undefined' : node.content === null ? 'null' : node.content === '' ? '""' : `"${node.content}"`}`);
    console.log(`  targetContent: "${targetContent}"`);
    console.log(`  Would portal be created? ${!!(true && targetContent)}`);
  });

  // ============================================================================
  // Conclusion
  // ============================================================================
  console.log('\n\n' + '='.repeat(80));
  console.log('CONCLUSIONS');
  console.log('='.repeat(80));
  console.log('1. Empty string "" fails the (visible && content) check');
  console.log('2. The fallback (content || label) DOES work for undefined/null');
  console.log('3. The fallback does NOT work for empty string ""');
  console.log('\nIf some chunks have content: "" (empty string), they will not render.');
  console.log('The API sets: content: kw.nodes.content || ""');
  console.log('So if DB content is null, API returns "", which fails the portal check!');
}

simulatePortalStateUpdate();
