# Documentation

## Guides

- [Local NPM Packages](guides/local-npm-packages.md) - Developing with locally checked-out packages (umapper)

## Architecture

### Features

- [Filtered Map View](architecture/filtered-map-view.md) - Exploring articles by filtering out query-related keywords to reveal hidden connections

### Investigations

- [Search Performance Investigation](architecture/search-performance-investigation.md) - Root cause analysis of search timeouts (resolved: PostgreSQL query planner behavior with explicit null parameters)

### Architecture Decision Records (ADRs)

- [ADR-005: Hierarchical Keyword Bubbling](architecture/adr/005-hierarchical-keywords.md) - LLM-based keyword reduction for semantic map performance
- [ADR-006: Keyword node_type Denormalization](architecture/adr/006-keyword-node-type-denormalization.md) - Partial HNSW index for 8x map query speedup
