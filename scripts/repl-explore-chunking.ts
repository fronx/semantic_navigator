/**
 * REPL Exploration Script: Chunking & Keywords
 *
 * This file contains snippets to copy/paste into the REPL for exploring
 * how files get chunked and what keywords are extracted.
 *
 * Usage:
 *   1. Start REPL: npm run script
 *   2. Copy/paste sections below
 *   3. Modify the folderPath variable to point to your folder
 *
 * Philosophy:
 *   Functions are small, composable, and pure transformations.
 *   Prefer functional composition over imperative orchestration.
 *   Each function does one thing and returns data for you to compose.
 *   No side effects, no console.logs - just data in, data out.
 */

// @ts-nocheck - REPL script with dynamic types

async function main() {

// ============================================================================
// STEP 1: Import dependencies (REPL syntax - use dynamic imports)
// ============================================================================

// Helper to import module (handles default export)
let use = async (path) => {
  let mod = await import(path)
  return mod.default || mod
}

let vault = await use('@/lib/vault')
let parser = await use('@/lib/parser')
let chunker = await use('@/lib/chunker')
let summarization = await use('@/lib/summarization')
let embeddings = await use('@/lib/embeddings')
let cacheUtils = await use('@/lib/cache-utils')
let arrayUtils = await use('@/lib/array-utils')
let fs = await import('fs/promises')
let repl = await import('repl')

// ============================================================================
// STEP 2: Load files
// ============================================================================

// Helper to collect async generator into array
let collect = async (generator) => {
  let items = []
  for await (const item of generator) items.push(item)
  return items
}

// Load file content
let loadFile = async (vaultPath, path) => ({
  path,
  name: path.split('/').pop(),
  content: await vault.readVaultFile(vaultPath, path)
})

// Example: Load files from folder
let vaultPath = process.env.VAULT_PATH
let folderPath = 'Writing/Have a Little Think'
let filePaths = await vault.collectMarkdownFiles(vaultPath, folderPath)
let files = await Promise.all(filePaths.map(p => loadFile(vaultPath, p)))

// ============================================================================
// STEP 3: Transform functions - compose these yourself
// ============================================================================

// Parse a file
let parseFile = (file) => ({
  ...file,
  parsed: parser.parseMarkdown(file.content, file.name)
})

// Get chunks from content
let getChunks = (content) => collect(chunker.chunkText(content))

// Cache utilities imported from src/lib/cache-utils.ts

// Save topSimilar Map to file (convert Map to object for JSON)
let saveTopSimilar = async (topSimilar, filePath = './data/top-similar.json') => {
  let obj = Object.fromEntries(topSimilar)
  await fs.writeFile(filePath, JSON.stringify(obj, null, 2))
}

// Load topSimilar from file (convert object back to Map)
let loadTopSimilar = async (filePath = './data/top-similar.json') => {
  try {
    let data = await fs.readFile(filePath, 'utf-8')
    let obj = JSON.parse(data)
    return new Map(Object.entries(obj))
  } catch {
    return new Map()
  }
}

// Get or generate chunks for files with caching (using generic cache utility)
let getOrGenerateChunks = async (files, cachePath = './data/chunks-cache.json') => {
  console.log(`\nProcessing ${files.length} files...`)

  return await cacheUtils.getOrCompute(
    files,
    cachePath,
    (file) => file.path,
    async (file) => {
      let parsed = parseFile(file)
      return await getChunks(parsed.parsed.content)
    },
    {
      onCached: (key, i, total) => console.log(`  [${i}/${total}] ✓ Cached: ${key.split('/').pop()}`),
      onCompute: (key, i, total) => console.log(`  [${i}/${total}] ⟳ Generating: ${key.split('/').pop()}`),
      onComplete: (cached, generated) => console.log(`\n✓ Finished: ${cached} cached, ${generated} generated\n`)
    }
  )
}

// Get or generate article summaries with caching (using generic cache utility)
let getOrGenerateArticleSummaries = async (files, cachePath = './data/article-summaries.json') => {
  console.log(`\nGenerating article summaries for ${files.length} files...`)

  return await cacheUtils.getOrCompute(
    files,
    cachePath,
    (file) => file.path,
    async (file) => {
      let parsed = parseFile(file)
      // Use parsed content (without frontmatter) instead of raw file content
      let result = await summarization.generateArticleSummary(
        parsed.parsed.title || file.name,
        parsed.parsed.content
      )
      return {
        title: parsed.parsed.title || file.name,
        type: result.type,
        ...(result.teaser && { teaser: result.teaser }),
        ...(result.content && { content: result.content })
      }
    },
    {
      onCached: (key, i, total) => console.log(`  [${i}/${total}] ✓ Cached: ${key.split('/').pop()}`),
      onCompute: (key, i, total) => console.log(`  [${i}/${total}] ⟳ Generating: ${key.split('/').pop()}`),
      onComplete: (cached, generated) => console.log(`\n✓ Finished: ${cached} cached, ${generated} generated\n`)
    }
  )
}

// Save keyword embeddings to cache
let saveKeywordEmbeddings = async (embeddingsMap, cachePath = './data/keyword-embeddings.json') => {
  await cacheUtils.saveCache(cachePath, Object.fromEntries(embeddingsMap))
}

// Load keyword embeddings from cache
let loadKeywordEmbeddings = async (cachePath = './data/keyword-embeddings.json') => {
  let data = await cacheUtils.loadCache(cachePath)
  return new Map(Object.entries(data))
}

// Get or generate keyword embeddings with caching
let getOrGenerateKeywordEmbeddings = async (keywords, cachePath = './data/keyword-embeddings.json') => {
  let cache = await loadKeywordEmbeddings(cachePath)

  // Find keywords that need embeddings
  let missing = keywords.filter(kw => !cache.has(kw))

  if (missing.length === 0) {
    console.log(`[Embeddings] All ${keywords.length} keywords cached`)
    // Return embeddings in the same order as input keywords
    return keywords.map(kw => cache.get(kw))
  }

  console.log(`[Embeddings] ${cache.size} cached, ${missing.length} to generate`)

  // Generate embeddings for missing keywords
  let newEmbeddings = await embeddings.generateEmbeddings(missing)

  // Update cache
  for (let i = 0; i < missing.length; i++) {
    cache.set(missing[i], newEmbeddings[i])
  }

  await saveKeywordEmbeddings(cache, cachePath)

  // Return embeddings in the same order as input keywords
  return keywords.map(kw => cache.get(kw))
}

// ============================================================================
// STEP 3: Generic utilities (now in src/lib/array-utils.ts and src/lib/cache-utils.ts)
// ============================================================================

// ============================================================================
// STEP 4: Domain-specific functions
// ============================================================================

let mathUtils = await use('@/lib/math-utils')
let llm = await use('@/lib/llm')
let keywordSim = await use('@/lib/keyword-similarity')
let keywordDedup = await use('@/lib/keyword-deduplication')

// ============================================================================
// STEP 4c: Prepare data for database insertion
// ============================================================================

// Get unique final keywords from deduplicated chunks
let getFinalKeywords = (chunksMap) => {
  let keywords = new Set()
  for (let chunks of chunksMap.values()) {
    for (let chunk of chunks) {
      for (let kw of chunk.keywords) {
        keywords.add(kw)
      }
    }
  }
  return Array.from(keywords).sort()
}

// Prepare keyword records for database insertion
let prepareKeywordRecords = async (finalKeywords) => {
  console.log(`\nPreparing ${finalKeywords.length} keyword records...`)

  // Generate embeddings for all final keywords
  let embeddings1536 = await embeddings.generateEmbeddingsBatched(
    finalKeywords,
    (completed, total) => {
      if (completed % 100 === 0 || completed === total) {
        console.log(`  [${completed}/${total}] embeddings generated`)
      }
    }
  )

  // Truncate to 256 dimensions
  console.log('  Truncating embeddings to 256 dimensions...')
  let embeddings256 = embeddings1536.map(emb => embeddings.truncateEmbedding(emb, 256))

  // Build keyword records
  let records = finalKeywords.map((keyword, i) => ({
    keyword,
    embedding: embeddings1536[i],
    embedding_256: embeddings256[i]
  }))

  console.log(`✓ Prepared ${records.length} keyword records\n`)
  return records
}

// Prepare keyword occurrences (which keywords appear in which chunks)
// Returns array of {keyword, file_path, chunk_position}
let prepareKeywordOccurrences = (chunksMap) => {
  let occurrences = []

  for (let [filePath, chunks] of chunksMap) {
    for (let chunk of chunks) {
      for (let keyword of chunk.keywords) {
        occurrences.push({
          keyword,
          file_path: filePath,
          chunk_position: chunk.position
        })
      }
    }
  }

  console.log(`✓ Prepared ${occurrences.length} keyword occurrences\n`)
  return occurrences
}

// Save prepared data for later database insertion
let savePreparedData = async (keywordRecords, keywordOccurrences) => {
  await fs.writeFile(
    './data/keywords-prepared.json',
    JSON.stringify({ keywordRecords, keywordOccurrences }, null, 2)
  )
  console.log('✓ Saved prepared data to ./data/keywords-prepared.json')
}

// Load prepared data
let loadPreparedData = async () => {
  try {
    let data = await fs.readFile('./data/keywords-prepared.json', 'utf-8')
    return JSON.parse(data)
  } catch {
    return { keywordRecords: [], keywordOccurrences: [] }
  }
}

// ============================================================================
// STEP 5: Example workflow
// ============================================================================

let chunksMap = await getOrGenerateChunks(files.slice(0, 5))
let articleSummaries = await getOrGenerateArticleSummaries(files.slice(0, 5))
let allChunks = Array.from(chunksMap.values()).flat()

let keywords = keywordDedup.getUniqueKeywords(chunksMap)
let allKeywords = allChunks.flatMap(ch => ch.keywords)  // For counting
let keywordCounts = keywordSim.countKeywords(allKeywords)
let top20 = arrayUtils.topEntries(keywordCounts, 20)

let embeds = await getOrGenerateKeywordEmbeddings(keywords)
let matrix = keywordSim.buildSimilarityMatrix(keywords, embeds)

let topSimilar = keywordSim.getTopSimilar(matrix)
let topSimilarCustom = keywordSim.getTopSimilar(matrix, { minThreshold: 0.6, topN: 10 })

await saveTopSimilar(topSimilar)
console.log('✓ Saved topSimilar to ./data/top-similar.json')

let clusters = keywordSim.clusterByThreshold(matrix, 0.85)
let deduped = keywordSim.deduplicateKeywords(clusters, keywordCounts)

// ============================================================================
// Complete workflow for database preparation
// ============================================================================

// 1. Run LLM-based deduplication
let mapping = await keywordDedup.deduplicateAllPairs(topSimilar, chunksMap, 0.7)

// 2. Apply deduplication to chunks
let dedupedChunks = keywordDedup.applyDeduplication(chunksMap, mapping)

// 3. Get final unique keywords
let finalKeywords = getFinalKeywords(dedupedChunks)

// 4. Generate embeddings for final keywords
let keywordRecords = await prepareKeywordRecords(finalKeywords)

// 5. Prepare keyword occurrences (which keywords go in which chunks)
let keywordOccurrences = prepareKeywordOccurrences(dedupedChunks)

// 6. Save everything for database insertion
await savePreparedData(keywordRecords, keywordOccurrences)
await cacheUtils.saveCache('./data/chunks-keywords-deduplicated.json', Object.fromEntries(dedupedChunks))

// ============================================================================
// STEP 6: Content embeddings
// ============================================================================

// Get or generate content embeddings for articles and chunks
let getOrGenerateContentEmbeddings = async (
  articleSummaries,  // Map: filePath -> {title, type, teaser?, content?}
  dedupedChunks,     // Map: filePath -> chunks[]
  cachePath = './data/content-embeddings.json'
) => {
  console.log('\nGenerating content embeddings...')

  // Check if already cached
  let cached = await cacheUtils.loadCache(cachePath)
  if (Object.keys(cached).length > 0) {
    console.log('✓ Content embeddings already cached')
    return cached
  }

  // Batch all texts: articles, then chunks
  let textsToEmbed = []
  let articlePaths = []
  let chunkRefs = []  // {path, position}

  // Collect article summaries
  for (let [path, summary] of articleSummaries) {
    // Use content if available (two-sentence summary), otherwise fall back to teaser
    let text = summary.content || summary.teaser || ''
    textsToEmbed.push(text)
    articlePaths.push(path)
  }

  // Collect chunk contents
  for (let [path, chunks] of dedupedChunks) {
    for (let chunk of chunks) {
      textsToEmbed.push(chunk.content)
      chunkRefs.push({ path, position: chunk.position })
    }
  }

  console.log(`  Batching ${textsToEmbed.length} texts (${articlePaths.length} articles + ${chunkRefs.length} chunks)`)

  // Generate embeddings
  let embeddingsArray = await embeddings.generateEmbeddingsBatched(
    textsToEmbed,
    (completed, total) => {
      if (completed % 100 === 0 || completed === total) {
        console.log(`  [${completed}/${total}] embeddings generated`)
      }
    }
  )

  // Split results
  let articleEmbeddings = embeddingsArray.slice(0, articlePaths.length)
  let chunkEmbeddings = embeddingsArray.slice(articlePaths.length)

  // Structure results
  let result = {
    articles: {},
    chunks: {}
  }

  // Map article embeddings
  for (let i = 0; i < articlePaths.length; i++) {
    result.articles[articlePaths[i]] = articleEmbeddings[i]
  }

  // Map chunk embeddings
  for (let i = 0; i < chunkRefs.length; i++) {
    let {path, position} = chunkRefs[i]
    if (!result.chunks[path]) result.chunks[path] = {}
    result.chunks[path][position] = chunkEmbeddings[i]
  }

  await cacheUtils.saveCache(cachePath, result)
  console.log(`✓ Saved ${articlePaths.length} article + ${chunkRefs.length} chunk embeddings\n`)

  return result
}

// ============================================================================
// STEP 7: Content hashing
// ============================================================================

// Get or generate content hashes for files
let getOrGenerateContentHashes = async (
  files,  // Array of {path, content}
  cachePath = './data/content-hashes.json'
) => {
  console.log('\nGenerating content hashes...')

  return await cacheUtils.getOrCompute(
    files,
    cachePath,
    (file) => file.path,
    async (file) => {
      let parsed = parseFile(file)
      // Hash the parsed content (without frontmatter) like ingestion-chunks.ts does
      return cacheUtils.hash(parsed.parsed.content)
    },
    {
      onCached: (key, i, total) => console.log(`  [${i}/${total}] ✓ Cached: ${key.split('/').pop()}`),
      onCompute: (key, i, total) => console.log(`  [${i}/${total}] ⟳ Hashing: ${key.split('/').pop()}`),
      onComplete: (cached, generated) => console.log(`\n✓ Finished: ${cached} cached, ${generated} generated\n`)
    }
  )
}

// ============================================================================
// STEP 8: Database payload preparation
// ============================================================================

// Prepare complete database insertion payloads (pure transformation, no DB access)
let prepareDatabasePayloads = async (
  articleSummaries,    // Map: filePath -> {title, type, teaser?, content?}
  contentEmbeddings,   // {articles: {path: embedding}, chunks: {path: {pos: embedding}}}
  contentHashes,       // Map: filePath -> hash
  dedupedChunks,       // Map: filePath -> chunks[]
  preparedData,        // {keywordRecords, keywordOccurrences}
  cachePath = './data/db-payloads.json'
) => {
  console.log('\nPreparing database payloads...')

  // Check if already cached
  let cached = await cacheUtils.loadCache(cachePath)
  if (cached.articles && cached.articles.length > 0) {
    console.log(`✓ Database payloads already cached (${cached.articles.length} articles)`)
    return cached
  }

  let payload = {
    articles: [],
    chunks: [],
    keywords: preparedData.keywordRecords,  // Already prepared in Step 4
    articleKeywords: {},   // path -> [keywords]
    chunkKeywords: {},     // path -> {position -> [keywords]}
    containmentEdges: []
  }

  // Build articles and chunks
  for (let [path, summary] of articleSummaries) {
    let articleHash = contentHashes.get(path)
    let articleEmbed = contentEmbeddings.articles[path]
    let chunks = dedupedChunks.get(path) || []

    if (!articleHash || !articleEmbed) {
      console.warn(`  ⚠ Missing hash or embedding for ${path}, skipping`)
      continue
    }

    // Article node
    let article = {
      title: summary.title,
      summary: summary.content || summary.teaser || '',
      embedding: articleEmbed,
      source_path: path,
      content_hash: articleHash,
      node_type: 'article'
    }
    payload.articles.push(article)

    // Article-level keywords (extract from chunks - will be reduced later by LLM)
    // For now, collect unique keywords from all chunks for this article
    let articleKws = new Set()
    for (let chunk of chunks) {
      for (let kw of chunk.keywords) {
        articleKws.add(kw)
      }
    }
    payload.articleKeywords[path] = Array.from(articleKws)

    // Chunk nodes and keywords
    if (!payload.chunkKeywords[path]) {
      payload.chunkKeywords[path] = {}
    }

    for (let chunk of chunks) {
      let chunkEmbed = contentEmbeddings.chunks[path]?.[chunk.position]
      if (!chunkEmbed) {
        console.warn(`  ⚠ Missing embedding for chunk ${path}:${chunk.position}`)
        continue
      }

      let chunkNode = {
        content: chunk.content,
        embedding: chunkEmbed,
        source_path: path,
        content_hash: articleHash,  // Same as parent article
        node_type: 'chunk',
        chunk_type: chunk.chunkType || null,
        heading_context: chunk.headingContext.length > 0 ? chunk.headingContext : null,
        position: chunk.position
      }
      payload.chunks.push(chunkNode)

      // Chunk keywords
      payload.chunkKeywords[path][chunk.position] = chunk.keywords

      // Containment edge
      payload.containmentEdges.push({
        parent_source_path: path,
        child_position: chunk.position,
        position: chunk.position  // Order within parent
      })
    }
  }

  await cacheUtils.saveCache(cachePath, payload)
  console.log(`✓ Prepared ${payload.articles.length} articles, ${payload.chunks.length} chunks`)
  console.log(`  ${payload.keywords.length} unique keywords, ${payload.containmentEdges.length} edges\n`)

  return payload
}

// ============================================================================
// STEP 9: Database insertion
// ============================================================================

// Import Supabase client
let supabaseLib = await use('@/lib/supabase')
let ingestionChunks = await use('@/lib/ingestion-chunks')

// Insert prepared payloads to database
let insertToDatabase = async (payload, options = { dryRun: false }) => {
  let supabase = supabaseLib.createServerClient()

  console.log(`\n${options.dryRun ? '[DRY RUN] ' : ''}Inserting to database...`)
  console.log(`  ${payload.articles.length} articles`)
  console.log(`  ${payload.chunks.length} chunks`)
  console.log(`  ${payload.keywords.length} keywords`)
  console.log(`  ${payload.containmentEdges.length} containment edges`)

  if (options.dryRun) {
    console.log('\n✓ Dry run complete (no database changes)\n')
    return { skipped: 0, created: 0, updated: 0 }
  }

  let stats = { skipped: 0, created: 0, updated: 0 }

  // Group data by article for batch processing
  let articlesByPath = new Map()
  for (let article of payload.articles) {
    articlesByPath.set(article.source_path, article)
  }

  let chunksByPath = new Map()
  for (let chunk of payload.chunks) {
    if (!chunksByPath.has(chunk.source_path)) {
      chunksByPath.set(chunk.source_path, [])
    }
    chunksByPath.get(chunk.source_path).push(chunk)
  }

  // Build keyword map for lookup
  let keywordMap = new Map()
  for (let kw of payload.keywords) {
    keywordMap.set(kw.keyword, kw)
  }

  // Process each article
  for (let [path, article] of articlesByPath) {
    console.log(`\n[${stats.created + stats.updated + stats.skipped + 1}/${payload.articles.length}] Processing: ${path.split('/').pop()}`)

    // Check if article exists
    let { data: existing } = await supabase
      .from('nodes')
      .select('id, content_hash')
      .eq('source_path', path)
      .eq('node_type', 'article')
      .maybeSingle()

    // Determine action
    let action = ingestionChunks.determineImportAction(
      existing,
      article.content_hash,
      options.forceReimport
    )

    if (action === 'skip') {
      console.log('  → Skip (no changes)')
      stats.skipped++
      continue
    }

    if (action === 'reimport') {
      console.log('  → Reimport (content changed)')
      // Delete existing article and all descendants
      await supabase.from('nodes').delete().eq('id', existing.id)
      stats.updated++
    } else {
      console.log('  → Create (new)')
      stats.created++
    }

    // Insert article node
    let { data: articleNode, error: articleError } = await supabase
      .from('nodes')
      .insert({
        content: null,
        summary: article.summary,
        content_hash: article.content_hash,
        embedding: article.embedding,
        node_type: 'article',
        source_path: article.source_path,
        title: article.title,
        header_level: null,
        chunk_type: null,
        heading_context: null
      })
      .select()
      .single()

    if (articleError) throw articleError
    console.log(`  ✓ Article created: ${articleNode.id}`)

    // Insert chunk nodes
    let chunks = chunksByPath.get(path) || []
    let chunkNodes = []

    for (let chunk of chunks) {
      let { data: chunkNode, error: chunkError } = await supabase
        .from('nodes')
        .insert({
          content: chunk.content,
          summary: null,
          content_hash: chunk.content_hash,
          embedding: chunk.embedding,
          node_type: 'chunk',
          source_path: chunk.source_path,
          title: null,
          header_level: null,
          chunk_type: chunk.chunk_type,
          heading_context: chunk.heading_context
        })
        .select()
        .single()

      if (chunkError) throw chunkError
      chunkNodes.push({ ...chunkNode, position: chunk.position })
    }
    console.log(`  ✓ ${chunks.length} chunks created`)

    // Insert containment edges
    let edges = payload.containmentEdges
      .filter(e => e.parent_source_path === path)
      .map(e => {
        let chunkNode = chunkNodes.find(c => c.position === e.child_position)
        return {
          parent_id: articleNode.id,
          child_id: chunkNode.id,
          position: e.position
        }
      })

    if (edges.length > 0) {
      let { error: edgesError } = await supabase
        .from('containment_edges')
        .insert(edges)
      if (edgesError) throw edgesError
      console.log(`  ✓ ${edges.length} containment edges created`)
    }

    // Upsert keywords and create occurrences
    let articleKws = payload.articleKeywords[path] || []
    let chunkKws = payload.chunkKeywords[path] || {}

    // Collect all unique keywords for this article
    let allKws = new Set([...articleKws])
    for (let kws of Object.values(chunkKws)) {
      for (let kw of kws) allKws.add(kw)
    }

    // Upsert keywords
    for (let kw of allKws) {
      let kwData = keywordMap.get(kw)
      if (!kwData) {
        console.warn(`  ⚠ Keyword not found in prepared data: ${kw}`)
        continue
      }

      let { data: kwRow, error: kwError } = await supabase
        .from('keywords')
        .upsert(
          {
            keyword: kwData.keyword,
            embedding: kwData.embedding,
            embedding_256: kwData.embedding_256
          },
          { onConflict: 'keyword' }
        )
        .select()
        .single()

      if (kwError) throw kwError

      // Create occurrences for article-level keywords
      if (articleKws.includes(kw)) {
        await supabase
          .from('keyword_occurrences')
          .upsert(
            {
              keyword_id: kwRow.id,
              node_id: articleNode.id,
              node_type: 'article'
            },
            { onConflict: 'keyword_id,node_id' }
          )
      }

      // Create occurrences for chunk-level keywords
      for (let chunkNode of chunkNodes) {
        let chunkKwList = chunkKws[chunkNode.position] || []
        if (chunkKwList.includes(kw)) {
          await supabase
            .from('keyword_occurrences')
            .upsert(
              {
                keyword_id: kwRow.id,
                node_id: chunkNode.id,
                node_type: 'chunk'
              },
              { onConflict: 'keyword_id,node_id' }
            )
        }
      }
    }
    console.log(`  ✓ ${allKws.size} keywords upserted with occurrences`)
  }

  console.log(`\n✓ Database insertion complete`)
  console.log(`  ${stats.created} created, ${stats.updated} updated, ${stats.skipped} skipped\n`)

  return stats
}

// ============================================================================
// NEW: Run Steps 6-9 to complete the pipeline
// ============================================================================

// Step 6: Generate content embeddings
let contentEmbeddings = await getOrGenerateContentEmbeddings(
  articleSummaries,
  dedupedChunks
)

// Step 7: Generate content hashes
let contentHashes = await getOrGenerateContentHashes(files.slice(0, 5))

// Step 8: Prepare database payloads
let dbPayloads = await prepareDatabasePayloads(
  articleSummaries,
  contentEmbeddings,
  contentHashes,
  dedupedChunks,
  { keywordRecords, keywordOccurrences }
)

// Step 9: Insert to database (dry run by default - set dryRun: false to execute)
// Uncomment to run: let dbStats = await insertToDatabase(dbPayloads, { dryRun: false })

// ============================================================================
// Start interactive REPL with all variables in scope
// ============================================================================

console.log('\n✓ All data loaded and prepared. Available variables:')
console.log('  files, chunksMap, allChunks')
console.log('  keywords, keywordCounts, top20')
console.log('  embeds, matrix')
console.log('  topSimilar, topSimilarCustom')
console.log('  clusters, deduped')
console.log('  mapping, dedupedChunks, finalKeywords')
console.log('  keywordRecords, keywordOccurrences')
console.log('  contentEmbeddings, contentHashes, dbPayloads')
console.log('\nFiles saved:')
console.log('  ./data/chunks-keywords-deduplicated.json')
console.log('  ./data/keywords-prepared.json')
console.log('  ./data/article-summaries.json')
console.log('  ./data/content-embeddings.json')
console.log('  ./data/content-hashes.json')
console.log('  ./data/db-payloads.json')
console.log('\nTo insert to database:')
console.log('  await insertToDatabase(dbPayloads, { dryRun: false })')
console.log('\nStarting REPL...\n')

const replServer = repl.start({ prompt: '> ' })

// Make all variables available in REPL context
Object.assign(replServer.context, {
  // Utility functions
  use, collect, parseFile, getChunks,
  getOrGenerateChunks, getOrGenerateArticleSummaries,
  getOrGenerateKeywordEmbeddings, saveKeywordEmbeddings, loadKeywordEmbeddings,
  saveTopSimilar, loadTopSimilar,
  getFinalKeywords, prepareKeywordRecords, prepareKeywordOccurrences,
  savePreparedData, loadPreparedData,
  getOrGenerateContentEmbeddings, getOrGenerateContentHashes,
  prepareDatabasePayloads, insertToDatabase,

  // Library modules
  vault, parser, chunker, summarization, embeddings,
  mathUtils, llm, keywordSim, keywordDedup,
  cacheUtils, arrayUtils,
  supabaseLib, ingestionChunks,
  fs,

  // Loaded data
  vaultPath, folderPath, filePaths, files,
  chunksMap, articleSummaries, allChunks,
  keywords, keywordCounts, top20,
  embeds, matrix,
  topSimilar, topSimilarCustom,
  clusters, deduped,

  // Final prepared data
  mapping, dedupedChunks, finalKeywords,
  keywordRecords, keywordOccurrences,
  contentEmbeddings, contentHashes, dbPayloads,
})

}

// Run main function
main().catch(console.error)
