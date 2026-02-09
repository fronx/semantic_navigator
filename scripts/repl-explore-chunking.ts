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
console.log('\nFiles saved:')
console.log('  ./data/chunks-keywords-deduplicated.json')
console.log('  ./data/keywords-prepared.json')
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

  // Library modules
  vault, parser, chunker, summarization, embeddings,
  mathUtils, llm, keywordSim, keywordDedup,
  cacheUtils, arrayUtils,
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
})

}

// Run main function
main().catch(console.error)
