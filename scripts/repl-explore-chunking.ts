/**
 * REPL Exploration Script: Chunking & Keywords
 *
 * This file contains snippets to copy/paste into the REPL for exploring
 * how files get chunked and what keywords are extracted.
 *
 * Usage:
 *   npm run script scripts/repl-explore-chunking.ts [limit]
 *
 *   Arguments:
 *     limit: (optional) Number of files to process
 *            - Default: 5
 *            - Use "all", "unlimited", or "0" for no limit
 *            - Examples: 10, 20, all
 *
 *   Examples:
 *     npm run script scripts/repl-explore-chunking.ts       # Process 5 files (default)
 *     npm run script scripts/repl-explore-chunking.ts 10    # Process 10 files
 *     npm run script scripts/repl-explore-chunking.ts all   # Process all files
 *
 * Configuration:
 *   - Modify the folderPath variable below to point to your target folder
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
  let cliUtils = await use('@/lib/cli-utils')
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

  // Wrappers for cache utilities with default paths
  let saveTopSimilar = (topSimilar, filePath = './data/top-similar.json') =>
    cacheUtils.saveMapCache(topSimilar, filePath)

  let loadTopSimilar = (filePath = './data/top-similar.json') =>
    cacheUtils.loadMapCache(filePath)

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
  // STEP 4: Domain-specific functions
  // ============================================================================

  let mathUtils = await use('@/lib/math-utils')
  let llm = await use('@/lib/llm')
  let keywordSim = await use('@/lib/keyword-similarity')
  let keywordDedup = await use('@/lib/keyword-deduplication')
  let clusteringUtils = await use('@/lib/clustering-utils')
  let ingestionUtils = await use('@/lib/ingestion-utils')

  // ============================================================================
  // STEP 4c: Prepare data for database insertion
  // ============================================================================

  // Import ingestion utilities from library
  let getFinalKeywords = keywordDedup.getUniqueKeywords
  let prepareKeywordRecords = ingestionUtils.prepareKeywordRecords
  let prepareKeywordOccurrences = ingestionUtils.prepareKeywordOccurrences

  // Wrappers for prepared data with default paths
  let savePreparedData = async (keywordRecords, keywordOccurrences) => {
    await cacheUtils.savePreparedKeywordData(keywordRecords, keywordOccurrences)
    console.log('✓ Saved prepared data to ./data/keywords-prepared.json')
  }

  let loadPreparedData = () => cacheUtils.loadPreparedKeywordData()

  // ============================================================================
  // STEP 5: Example workflow
  // ============================================================================

  // Parse file limit from command line arguments
  let fileLimit: number | null
  try {
    fileLimit = cliUtils.parseLimit(process.argv[2], 5)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }

  let filesToProcess = fileLimit === null ? files : files.slice(0, fileLimit)
  console.log(`\nProcessing ${filesToProcess.length} file(s) ${fileLimit === null ? '(no limit)' : `(limit: ${fileLimit})`}\n`)

  let chunksMap = await getOrGenerateChunks(filesToProcess)
  let articleSummaries = await getOrGenerateArticleSummaries(filesToProcess)
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
      let { path, position } = chunkRefs[i]
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

  // ============================================================================
  // STEP 9: Incremental ingestion pipeline
  // ============================================================================

  // Process a batch of articles (orchestrates library functions)
  // Returns: { summaries, embeddings, hashes, payloads, insertStats }
  let processArticleBatch = async (
    batch,              // Array of files to process
    dedupMapping,       // Keyword deduplication mapping from Step 1-6
    preparedKeywords,   // {keywordRecords, keywordOccurrences} from Step 4
    supabase,           // Supabase client (passed explicitly)
    options = { dryRun: false }
  ) => {
    // Step 1: Generate article summaries
    let batchSummaries = await getOrGenerateArticleSummaries(batch)

    // Step 2: Generate chunks
    let batchChunksMap = await getOrGenerateChunks(batch)

    // Step 3: Apply deduplication to chunks
    let batchDedupedChunks = keywordDedup.applyDeduplication(batchChunksMap, dedupMapping)

    // Step 4: Generate content embeddings
    let batchContentEmbeddings = await getOrGenerateContentEmbeddings(
      batchSummaries,
      batchDedupedChunks
    )

    // Step 5: Generate content hashes
    let batchContentHashes = await getOrGenerateContentHashes(batch)

    // Step 6: Prepare database payloads
    let batchPayloads = await prepareDatabasePayloads(
      batchSummaries,
      batchContentEmbeddings,
      batchContentHashes,
      batchDedupedChunks,
      preparedKeywords
    )

    // Step 7: Insert to database
    let insertStats = await insertToDatabase(batchPayloads, options)

    return {
      processed: batch.length,
      summaries: batchSummaries,
      embeddings: batchContentEmbeddings,
      hashes: batchContentHashes,
      payloads: batchPayloads,
      insertStats
    }
  }

  // Main orchestration: processes files in batches with idempotency
  // Returns structured data (no logging - use wrapper below for progress logs)
  let runIncrementalIngestion = async (
    supabase,
    files,
    dedupMapping,
    preparedData,
    options = { batchSize: 5, dryRun: false }
  ) => {
    // Get already processed hashes
    let processedHashes = await ingestionUtils.getAlreadyProcessedHashes(supabase)

    // Filter articles to process (pure transformation)
    let articlesToProcess = []
    for (let file of files) {
      let parsed = parseFile(file)
      let hash = cacheUtils.hash(parsed.parsed.content)
      if (!processedHashes.has(hash)) {
        articlesToProcess.push(file)
      }
    }

    let skippedCount = files.length - articlesToProcess.length

    if (articlesToProcess.length === 0) {
      return {
        batches: [],
        stats: { created: 0, updated: 0, skipped: skippedCount, processed: 0 }
      }
    }

    // Batch articles using pure utility
    let batches = arrayUtils.batch(articlesToProcess, options.batchSize)

    // Track results per batch
    let batchResults = []
    let totalStats = { created: 0, updated: 0, skipped: 0, processed: 0 }

    // Process each batch
    for (let i = 0; i < batches.length; i++) {
      let batch = batches[i]

      let result = await processArticleBatch(
        batch,
        dedupMapping,
        preparedData,
        supabase,
        options
      )

      // Extract stats from result
      let batchStats = result.insertStats

      // Accumulate stats
      totalStats.created += batchStats.created || 0
      totalStats.updated += batchStats.updated || 0
      totalStats.skipped += batchStats.skipped || 0
      totalStats.processed += result.processed || 0

      // Record batch result
      batchResults.push({
        batchIndex: i,
        articles: batch.map(f => f.path),
        processed: result.processed,
        stats: batchStats
      })
    }

    totalStats.skipped += skippedCount

    return {
      batches: batchResults,
      stats: totalStats
    }
  }

  // Convenience wrapper with logging (thin orchestration layer)
  let runIncrementalIngestionWithProgress = async (options = { batchSize: 5, dryRun: false }) => {
    let supabase = supabaseLib.createServerClient()

    console.log('\n=== Incremental Ingestion Pipeline ===\n')
    console.log(`Batch size: ${options.batchSize}`)
    console.log(`Dry run: ${options.dryRun ? 'YES' : 'NO'}\n`)

    // Load cached prerequisites (from Steps 1-6)
    console.log('Phase 1: Loading cached keyword analysis...')
    let preparedData = await loadPreparedData()

    if (!preparedData.keywordRecords || preparedData.keywordRecords.length === 0) {
      console.error('ERROR: No prepared keyword data found. Run Steps 1-6 first.')
      return null
    }

    console.log(`✓ Loaded ${preparedData.keywordRecords.length} keywords from cache`)

    // Run pure ingestion pipeline
    let result = await runIncrementalIngestion(
      supabase,
      filesToProcess,
      mapping,
      preparedData,
      options
    )

    // Log progress
    console.log(`\n✓ Found ${result.stats.skipped} already-processed articles`)
    console.log(`Phase 2: Article Ingestion`)
    console.log(`Processing ${result.batches.length} batches\n`)

    for (let batch of result.batches) {
      console.log(`\n=== Batch ${batch.batchIndex + 1}/${result.batches.length} ===`)
      console.log(`  Processed: ${batch.processed} articles`)
      console.log(`  Created: ${batch.stats.created}`)
      console.log(`  Updated: ${batch.stats.updated}`)
      console.log(`  Skipped: ${batch.stats.skipped}`)
    }

    console.log(`\n=== Ingestion Complete ===`)
    console.log(`Total processed: ${result.stats.processed} articles`)
    console.log(`Created: ${result.stats.created}`)
    console.log(`Updated: ${result.stats.updated}`)
    console.log(`Skipped: ${result.stats.skipped}\n`)

    return result
  }

  // ============================================================================
  // Legacy database insertion (kept for backward compatibility)
  // ============================================================================

  // Insert prepared payloads to database
  let insertToDatabase = async (payload, options = { dryRun: false }) => {
    let supabase = supabaseLib.createServerClient()

    console.log(`${options.dryRun ? '[DRY RUN] ' : ''}Inserting to database...`)
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
  let contentHashes = await getOrGenerateContentHashes(filesToProcess)

  // Step 8: Prepare database payloads
  let dbPayloads = await prepareDatabasePayloads(
    articleSummaries,
    contentEmbeddings,
    contentHashes,
    dedupedChunks,
    { keywordRecords, keywordOccurrences }
  )

  // Step 9: Incremental ingestion (automatically runs with idempotency)
  let ingestionStats = await runIncrementalIngestionWithProgress({ batchSize: 5, dryRun: false })

  // ============================================================================
  // STEP 10: Precompute topic clusters (for TopicsView)
  // ============================================================================

  let leidenClustering = await use('@/lib/leiden-clustering')

  // Precompute clusters for a given node type (article or chunk)
  let precomputeTopicClusters = async (
    nodeType = 'chunk',  // 'article' or 'chunk'
    resolutions = [0.1, 0.3, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0],
    options = { dryRun: false }
  ) => {
    let supabase = supabaseLib.createServerClient()

    console.log(`\n${options.dryRun ? '[DRY RUN] ' : ''}Precomputing clusters for ${nodeType} keywords...`)

    // Fetch keyword graph from database using RPC
    console.log('Fetching keyword graph...')
    let { data: rawPairs, error } = await supabase.rpc(
      'get_keyword_graph',
      {
        filter_node_type: nodeType,
        max_edges_per_node: 10,
        min_similarity: 0.3
      }
    )

    if (error) {
      console.error('Error fetching keyword graph:', error)
      return null
    }

    if (!rawPairs || rawPairs.length === 0) {
      console.log(`No keyword graph data found for ${nodeType}. Run Step 9 (insertToDatabase) first.`)
      return null
    }

    // Convert pairs to nodes and edges
    let { nodes, edges } = convertPairsToGraph(rawPairs)
    console.log(`Graph: ${nodes.length} nodes, ${edges.length} edges`)

    // Fetch embeddings for nodes
    console.log('Fetching embeddings...')
    await fetchEmbeddings(supabase, nodes, nodeType)

    if (options.dryRun) {
      console.log(`\n✓ Dry run complete. Would precompute ${resolutions.length} resolutions for ${nodes.length} nodes\n`)
      return { nodes, edges }
    }

    // Clear existing clusters for this node type
    console.log(`Clearing existing clusters for ${nodeType}...`)
    await supabase
      .from('precomputed_topic_clusters')
      .delete()
      .eq('node_type', nodeType)

    let allRows = []

    // Compute clusters at each resolution
    for (let resolution of resolutions) {
      console.log(`\n=== Resolution ${resolution} ===`)

      // Run Leiden clustering
      console.log('Running Leiden clustering...')
      let { nodeToCluster, clusters } = leidenClustering.computeLeidenClustering(
        nodes,
        edges,
        resolution
      )

      console.log(`Generated ${clusters.size} clusters`)

      // Generate semantic labels via Haiku
      let clustersForLabeling = Array.from(clusters.values()).map(c => ({
        id: c.id,
        keywords: c.members
      }))

      console.log(`Calling Haiku API for ${clustersForLabeling.length} labels...`)
      let labels = await llm.generateClusterLabels(clustersForLabeling)

      // Build rows for insertion
      for (let [nodeId, clusterId] of nodeToCluster) {
        let cluster = clusters.get(clusterId)
        allRows.push({
          resolution,
          node_type: nodeType,
          node_id: nodeId,
          cluster_id: clusterId,
          hub_node_id: `kw:${cluster.hub}`,
          cluster_label: labels[clusterId] || cluster.hub,
          member_count: cluster.members.length
        })
      }

      console.log(`✓ Resolution ${resolution} complete`)
    }

    // Insert all rows
    console.log(`\nInserting ${allRows.length} cluster assignments...`)
    let BATCH_SIZE = 500
    for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
      let batch = allRows.slice(i, i + BATCH_SIZE)
      let { error: insertError } = await supabase
        .from('precomputed_topic_clusters')
        .insert(batch)

      if (insertError) {
        console.error('Insert error:', insertError)
        throw insertError
      }

      console.log(`  ${Math.min(i + BATCH_SIZE, allRows.length)}/${allRows.length}`)
    }

    console.log(`\n✓ Precomputed ${resolutions.length} resolutions for ${nodeType}`)
    return { nodes, edges, clusters: allRows }
  }

  // Import clustering utilities from library
  let convertPairsToGraph = clusteringUtils.convertPairsToGraph
  let fetchEmbeddings = clusteringUtils.fetchEmbeddings

  // Step 10: Precompute clusters (dry run by default - set dryRun: false to execute)
  // Uncomment to run: let clusterResults = await precomputeTopicClusters('chunk', undefined, { dryRun: false })

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
  console.log('\nPure functions (from libraries):')
  console.log('  arrayUtils.batch(items, size) - batch array')
  console.log('  ingestionUtils.getAlreadyProcessedHashes(supabase) - get processed hashes')
  console.log('  runIncrementalIngestion(supabase, files, mapping, preparedData, options) - pure pipeline')
  console.log('\nConvenience wrappers (with logging):')
  console.log('  runIncrementalIngestionWithProgress(options) - with progress logs')
  console.log('  insertToDatabase(payload, options) - legacy insertion with logs')
  console.log('\nFiles saved:')
  console.log('  ./data/chunks-keywords-deduplicated.json')
  console.log('  ./data/keywords-prepared.json')
  console.log('  ./data/article-summaries.json')
  console.log('  ./data/content-embeddings.json')
  console.log('  ./data/content-hashes.json')
  console.log('  ./data/db-payloads.json')
  console.log('\nPipeline steps:')
  console.log('  Step 9 (legacy): await insertToDatabase(dbPayloads, { dryRun: false })')
  console.log('  Step 9 (incremental): await runIncrementalIngestionWithProgress({ batchSize: 5, dryRun: false })')
  console.log('  Step 10: await precomputeTopicClusters("chunk", undefined, { dryRun: false })')
  console.log('  Step 10 (articles): await precomputeTopicClusters("article", undefined, { dryRun: false })')
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
    precomputeTopicClusters, convertPairsToGraph, fetchEmbeddings,

    // Incremental ingestion functions
    processArticleBatch, runIncrementalIngestion, runIncrementalIngestionWithProgress,

    // Library modules
    vault, parser, chunker, summarization, embeddings,
    mathUtils, llm, keywordSim, keywordDedup,
    cacheUtils, arrayUtils, cliUtils,
    supabaseLib, ingestionChunks, ingestionUtils, leidenClustering,
    clusteringUtils,
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
