import { createServerClient } from '../src/lib/supabase';
import { NodeType } from '../src/lib/types';
import { groupByIdentity, nodeIdentityKeys } from '../src/lib/node-identity';

const supabase = createServerClient();

interface NodeRow {
  id: string;
  node_type: NodeType;
  source_path: string;
  content_hash: string;
  created_at: string;
}

async function deduplicateNodeType(nodeType: NodeType) {
  const identityKeys = nodeIdentityKeys[nodeType];
  console.log(`\n--- Deduplicating ${nodeType}s (identity: ${identityKeys.join(', ')}) ---`);

  const { data: nodes } = await supabase
    .from('nodes')
    .select('id, node_type, source_path, content_hash, created_at')
    .eq('node_type', nodeType)
    .order('created_at', { ascending: true });

  if (!nodes || nodes.length === 0) {
    console.log(`No ${nodeType}s found`);
    return;
  }

  const groups = groupByIdentity(nodes as NodeRow[]);

  let keptCount = 0;
  let deletedCount = 0;

  for (const [key, group] of groups) {
    if (group.length === 1) {
      keptCount++;
      continue;
    }

    // Keep the first (oldest) one, delete the rest
    const [keep, ...duplicates] = group;

    const duplicateIds = duplicates.map(d => d.id);
    const { error } = await supabase
      .from('nodes')
      .delete()
      .in('id', duplicateIds);

    if (error) {
      console.error(`  Error deleting duplicates for ${key}:`, error);
    } else {
      keptCount++;
      deletedCount += duplicates.length;
    }
  }

  console.log(`${nodeType}s: kept ${keptCount}, deleted ${deletedCount}`);
}

async function showStats() {
  console.log('\n--- Final Stats ---');

  for (const nodeType of ['article', 'section', 'paragraph'] as NodeType[]) {
    const { count } = await supabase
      .from('nodes')
      .select('*', { count: 'exact', head: true })
      .eq('node_type', nodeType);

    console.log(`${nodeType}s: ${count}`);
  }
}

async function main() {
  console.log('Starting deduplication...');

  // Process in order: paragraphs first (leaves), then sections, then articles
  await deduplicateNodeType('paragraph');
  await deduplicateNodeType('section');
  await deduplicateNodeType('article');
  await showStats();

  console.log('\nDone!');
}

main().catch(console.error);
