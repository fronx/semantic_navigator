# Investigation Scripts

Temporary debugging, benchmarking, and verification scripts used for one-off investigations.

## Purpose

These scripts are created during development to:
- Debug specific issues
- Profile performance characteristics
- Verify bug fixes
- Test data flow and transformations
- Benchmark rendering and API performance

## Lifecycle

- **Create** when investigating a bug or performance issue
- **Keep** while actively debugging
- **Delete** once the issue is resolved and knowledge is captured in docs/ADRs
- Scripts older than 2-3 months should be reviewed for deletion

## Usage

Run any script with:
```bash
npm run script scripts/investigations/<script-name>.ts
```

## Script Categories

### Testing & Verification
- `test-*.ts` - Unit/integration tests for specific components
- `verify-*.ts` - Verification scripts for bug fixes

### Debugging & Tracing
- `debug-*.ts` - Debug specific subsystems
- `trace-*.ts` - Trace data flow through the system
- `investigate-*.ts` - Deep investigation of specific issues

### Performance Analysis
- `benchmark-*.ts` - Performance benchmarks
- `profile-*.ts` - Profiling scripts
- `analyze-*.ts` - Analysis of system characteristics

### Comparison
- `compare-*.ts` - Compare different approaches or implementations
