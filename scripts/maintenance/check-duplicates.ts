import { createServerClient } from '../src/lib/supabase';

const supabase = createServerClient();

const testFiles = [
  'Dependent Agency.md',
  'How do You Grow Agency.md',
  'Claude notes on agency.md',
  'agency-1.md'
];

async function checkExisting() {
  for (const file of testFiles) {
    const { data: nodes } = await supabase
      .from('nodes')
      .select('id, node_type, source_path, content_hash, created_at')
      .ilike('source_path', '%' + file)
      .order('created_at', { ascending: true });

    console.log('\n--- ' + file + ' ---');
    if (nodes && nodes.length > 0) {
      console.log('Found', nodes.length, 'nodes:');
      const types = nodes.reduce((acc, n) => {
        acc[n.node_type] = (acc[n.node_type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      console.log('  Types:', types);

      // Check for duplicate articles
      const articles = nodes.filter(n => n.node_type === 'article');
      if (articles.length > 1) {
        console.log('  WARNING: Multiple article nodes!');
        articles.forEach(a => console.log('    - created:', a.created_at));
      }
    } else {
      console.log('No nodes found');
    }
  }

  // Check total article count vs unique source_paths
  const { data: allArticles } = await supabase
    .from('nodes')
    .select('source_path')
    .eq('node_type', 'article');

  if (allArticles) {
    const uniquePaths = new Set(allArticles.map(a => a.source_path));
    console.log('\n--- Overall Stats ---');
    console.log('Total article nodes:', allArticles.length);
    console.log('Unique source paths:', uniquePaths.size);
    if (allArticles.length !== uniquePaths.size) {
      console.log('WARNING: Duplicate articles detected!');
    }
  }
}

checkExisting().catch(console.error);
