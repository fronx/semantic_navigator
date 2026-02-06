# Maintenance Scripts

Ongoing database management, cluster computation, and system maintenance tasks.

## Purpose

These scripts are used for:
- Database migrations and backfills
- Cluster computation (communities, topics)
- Data quality checks and cleanup
- Embedding and PCA computation
- Content reimport and deduplication

## Lifecycle

- **Permanent** - These scripts are kept long-term as operational tools
- **Versioned** - Changes should be committed to git
- **Documented** - Reference in docs/ when they affect system behavior

## Usage

Run any script with:
```bash
npm run script scripts/maintenance/<script-name>.ts
```

## Script Categories

### Cluster Management
- `compute-keyword-communities.ts` - Compute Louvain community clustering for MapView
- `precompute-topic-clusters.ts` - Compute Leiden clustering for TopicsView
- `compute-embedding-pca.ts` - Compute PCA transform for semantic colors

See [Clustering Systems Guide](../../docs/guides/clustering-systems.md) for details.

### Data Quality
- `check-*.ts` - Verify data quality and consistency
- `deduplicate-nodes.ts` - Remove duplicate nodes
- `backfill-*.ts` - Backfill missing data

### Import & Migration
- `migrate-to-chunks.ts` - Migrate article nodes to chunk structure
- `reimport-article.ts` - Re-import specific articles
- `reset-and-test.ts` - Reset database and test import pipeline

### Inspection
- `inspect-keyword-communities.ts` - Inspect cluster hierarchy and statistics
- `survey-documents.ts` - Survey document corpus characteristics

## Maintenance Schedule

Some scripts should be run periodically:
- **After bulk imports**: Run cluster computation scripts
- **Weekly**: Check data quality with `check-*.ts` scripts
- **As needed**: Deduplicate, backfill, migrate based on system changes
