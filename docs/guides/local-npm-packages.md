# Local NPM Packages

This guide documents how to develop Semantic Navigator alongside locally checked-out npm packages.

## Current Local Dependencies

- **umapper** - UMAP-inspired layout algorithm for the map view

## Setup

Use the `file:` protocol in `package.json` to reference local packages:

```json
{
  "dependencies": {
    "umapper": "file:../umapper"
  }
}
```

After modifying the path, run:

```bash
npm install
```

This creates a symlink in `node_modules/` pointing to your local package.

## Development Workflow

When developing the local package alongside this project:

1. **Build the package** after making changes:
   ```bash
   cd ../umapper && npm run build:lib
   ```

2. **Changes are reflected immediately** in the Next.js dev server (hot reload works through the symlink)

3. **Type definitions** update after rebuilding the package

## Why `file:` Instead of `npm link`

`npm link` can cause issues with:
- ESM/CJS module resolution in some bundlers
- Path resolution with symlinked packages
- React/Next.js hot reload

The `file:` protocol avoids these issues by letting the bundler resolve the symlink during build.

## Troubleshooting

### Types not updating
Rebuild the local package:
```bash
cd ../umapper && npm run build:lib
```

### Module not found errors
Ensure the package is built and has `dist/` output:
```bash
ls ../umapper/dist/
# Should show: index.js, index.es.js, index.d.ts
```

### Stale node_modules
Remove and reinstall:
```bash
rm -rf node_modules/.cache
npm install
```
