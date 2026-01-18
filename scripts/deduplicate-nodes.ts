import { createServerClient } from '../src/lib/supabase';
import { NodeType } from '../src/lib/types';
import { groupByIdentity, nodeIdentityKeys } from '../src/lib/node-identity';

const supabase = createServerClient();

interface NodeRow {
  id: string;
  node_type: NodeType;
  source_path: string | null;
  content_hash: string;
  title: string | null;
  created_at: string;
}

async function deduplicateNodeType(nodeType: NodeType) {
  const identityKeys = nodeIdentityKeys[nodeType];
  console.log(`\n--- Deduplicating ${nodeType}s (identity: ${identityKeys.join(', ')}) ---`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: nodes } = await (supabase as any)
    .from('nodes')
    .select('id, node_type, source_path, content_hash, title, created_at')
    .eq('node_type', nodeType)
    .order('created_at', { ascending: true }) as { data: NodeRow[] | null };

  if (!nodes || nodes.length === 0) {
    console.log(`No ${nodeType}s found`);
    return;
  }

  const groups = groupByIdentity(nodes);

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

  for (const nodeType of ['article', 'chunk'] as NodeType[]) {
    const { count } = await supabase
      .from('nodes')
      .select('*', { count: 'exact', head: true })
      .eq('node_type', nodeType);

    console.log(`${nodeType}s: ${count}`);
  }
}

async function main() {
  console.log('Starting deduplication...');

  // Process in order: chunks first (leaves), then articles
  await deduplicateNodeType('chunk');
  await deduplicateNodeType('article');
  await showStats();

  console.log('\nDone!');
}

main().catch(console.error);
