# Scripts

Utility scripts for database inspection, maintenance, and development.

## Organization

Scripts are organized into subdirectories by purpose:

- **`investigations/`** - Temporary debugging, benchmarking, and verification scripts
  - Created during active development to investigate issues
  - Should be deleted once the issue is resolved
  - See [investigations/README.md](./investigations/README.md)

- **`maintenance/`** - Permanent operational scripts for database and cluster management
  - Cluster computation (communities, topics, PCA)
  - Data quality checks and cleanup
  - Import/migration utilities
  - See [maintenance/README.md](./maintenance/README.md)

- **Root** - Frequently-used utility scripts referenced in documentation

## Running Scripts

All scripts support environment variable loading from `.env.local`:

```bash
npm run script scripts/<name>.ts
npm run script scripts/maintenance/<name>.ts
npm run script scripts/investigations/<name>.ts
```

## Root Utility Scripts

### query-nodes.ts

Look up specific nodes by UUID.

```bash
npm run script scripts/query-nodes.ts <uuid> [uuid...]
```

For detailed information about maintenance and investigation scripts, see the README files in their respective subdirectories.
