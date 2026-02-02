/**
 * Memory leak detection tests using Playwright + Chrome DevTools Protocol.
 *
 * Measures JS heap size over repeated interactions to detect memory leaks.
 * Run with: npx playwright test tests/e2e/memory-leak.spec.ts
 *
 * Prerequisites:
 * 1. Start the dev server: npm run dev
 * 2. Ensure there's data in the database (keywords/articles)
 */

import { test, type Page, type CDPSession } from '@playwright/test';

// Increase default timeout for memory tests
test.setTimeout(120000);

interface MemoryInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface MemorySample {
  label: string;
  usedMB: number;
  totalMB: number;
  timestamp: number;
}

/**
 * Get current JS heap memory info via Chrome DevTools Protocol
 */
async function getMemoryInfo(page: Page): Promise<MemoryInfo> {
  // Force garbage collection first for more accurate measurements
  const client = await page.context().newCDPSession(page);
  await client.send('HeapProfiler.collectGarbage');
  await client.detach();

  // Small delay for GC to complete
  await page.waitForTimeout(100);

  return page.evaluate(() => {
    // @ts-expect-error - performance.memory is Chrome-specific
    const memory = performance.memory;
    if (!memory) {
      throw new Error('performance.memory not available - run with --enable-precise-memory-info');
    }
    return {
      usedJSHeapSize: memory.usedJSHeapSize,
      totalJSHeapSize: memory.totalJSHeapSize,
      jsHeapSizeLimit: memory.jsHeapSizeLimit,
    };
  });
}

/**
 * Take a heap snapshot (for detailed analysis)
 */
async function takeHeapSnapshot(client: CDPSession, filename: string): Promise<void> {
  const chunks: string[] = [];

  client.on('HeapProfiler.addHeapSnapshotChunk', (params) => {
    chunks.push(params.chunk);
  });

  await client.send('HeapProfiler.enable');
  await client.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });

  const { writeFileSync } = await import('fs');
  writeFileSync(filename, chunks.join(''));
  console.log(`Heap snapshot saved to: ${filename}`);
}

/**
 * Print memory samples as a table
 */
function printMemoryTable(samples: MemorySample[]): void {
  console.log('\n=== Memory Usage Report ===\n');
  console.log('| Stage | Used Heap (MB) | Total Heap (MB) | Delta (MB) |');
  console.log('|-------|----------------|-----------------|------------|');

  let previousUsed = 0;
  for (const sample of samples) {
    const delta = previousUsed === 0 ? '-' : (sample.usedMB - previousUsed).toFixed(2);
    console.log(
      `| ${sample.label.padEnd(40)} | ${sample.usedMB.toFixed(2).padStart(14)} | ${sample.totalMB.toFixed(2).padStart(15)} | ${String(delta).padStart(10)} |`
    );
    previousUsed = sample.usedMB;
  }
  console.log('');
}

test.describe('Memory Leak Detection - Topics Page', () => {
  test('intensive zoom and pan interactions', async ({ page }) => {
    const samples: MemorySample[] = [];

    const recordMemory = async (label: string) => {
      const info = await getMemoryInfo(page);
      samples.push({
        label,
        usedMB: info.usedJSHeapSize / 1024 / 1024,
        totalMB: info.totalJSHeapSize / 1024 / 1024,
        timestamp: Date.now(),
      });
    };

    // Go directly to Topics page
    await page.goto('/topics');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000); // Wait for graph to render and stabilize
    await recordMemory('Topics page loaded');

    // Get viewport size
    const viewport = page.viewportSize() || { width: 1280, height: 720 };
    const centerX = viewport.width / 2;
    const centerY = viewport.height / 2;

    // Intensive zoom cycles
    for (let cycle = 1; cycle <= 10; cycle++) {
      // Zoom in deeply (multiple scroll events)
      await page.mouse.move(centerX, centerY);
      for (let i = 0; i < 10; i++) {
        await page.mouse.wheel(0, -100);
        await page.waitForTimeout(50);
      }
      await page.waitForTimeout(200);

      // Zoom out fully
      for (let i = 0; i < 15; i++) {
        await page.mouse.wheel(0, 100);
        await page.waitForTimeout(50);
      }
      await page.waitForTimeout(200);

      if (cycle % 2 === 0) {
        await recordMemory(`After zoom cycle ${cycle}`);
      }
    }

    // Intensive pan interactions
    for (let cycle = 1; cycle <= 5; cycle++) {
      // Pan in a square pattern
      await page.mouse.move(centerX - 200, centerY - 200);
      await page.mouse.down();
      await page.mouse.move(centerX + 200, centerY - 200, { steps: 20 });
      await page.mouse.move(centerX + 200, centerY + 200, { steps: 20 });
      await page.mouse.move(centerX - 200, centerY + 200, { steps: 20 });
      await page.mouse.move(centerX - 200, centerY - 200, { steps: 20 });
      await page.mouse.up();
      await page.waitForTimeout(200);

      await recordMemory(`After pan cycle ${cycle}`);
    }

    // Combined zoom + pan
    for (let cycle = 1; cycle <= 5; cycle++) {
      // Zoom to a corner
      await page.mouse.move(centerX + 200, centerY + 200);
      await page.mouse.wheel(0, -300);
      await page.waitForTimeout(200);

      // Pan around while zoomed in
      await page.mouse.down();
      await page.mouse.move(centerX - 100, centerY - 100, { steps: 15 });
      await page.mouse.up();

      // Zoom back out
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(200);

      await recordMemory(`After zoom+pan cycle ${cycle}`);
    }

    // Final measurement
    await page.waitForTimeout(1000);
    await recordMemory('Final');

    printMemoryTable(samples);

    // Calculate memory growth
    const baselineMemory = samples[0].usedMB;
    const finalMemory = samples[samples.length - 1].usedMB;
    const growthMB = finalMemory - baselineMemory;
    const growthPercent = ((finalMemory - baselineMemory) / baselineMemory) * 100;

    console.log(`Memory Growth Summary:`);
    console.log(`  Baseline: ${baselineMemory.toFixed(2)} MB`);
    console.log(`  Final:    ${finalMemory.toFixed(2)} MB`);
    console.log(`  Growth:   ${growthMB.toFixed(2)} MB (${growthPercent.toFixed(1)}%)`);

    if (growthPercent > 30) {
      console.warn('\nWARNING: Significant memory growth detected during zoom/pan');
    }
  });

  test('hover interactions over nodes', async ({ page }) => {
    const samples: MemorySample[] = [];

    const recordMemory = async (label: string) => {
      const info = await getMemoryInfo(page);
      samples.push({
        label,
        usedMB: info.usedJSHeapSize / 1024 / 1024,
        totalMB: info.totalJSHeapSize / 1024 / 1024,
        timestamp: Date.now(),
      });
    };

    // Go directly to Topics page
    await page.goto('/topics');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    await recordMemory('Topics page loaded');

    const viewport = page.viewportSize() || { width: 1280, height: 720 };
    const centerX = viewport.width / 2;
    const centerY = viewport.height / 2;

    // Move mouse around the canvas to trigger hover effects
    // This tests the hover controller and highlighting system
    for (let cycle = 1; cycle <= 10; cycle++) {
      // Sweep horizontally across the canvas
      for (let x = 100; x < viewport.width - 100; x += 30) {
        await page.mouse.move(x, centerY);
        await page.waitForTimeout(20);
      }

      // Sweep vertically
      for (let y = 100; y < viewport.height - 100; y += 30) {
        await page.mouse.move(centerX, y);
        await page.waitForTimeout(20);
      }

      // Sweep diagonally
      for (let i = 0; i < 20; i++) {
        const x = 100 + (viewport.width - 200) * (i / 20);
        const y = 100 + (viewport.height - 200) * (i / 20);
        await page.mouse.move(x, y);
        await page.waitForTimeout(20);
      }

      // Move to center then leave canvas (triggers mouseLeave)
      await page.mouse.move(centerX, centerY);
      await page.waitForTimeout(100);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(100);

      if (cycle % 2 === 0) {
        await recordMemory(`After hover cycle ${cycle}`);
      }
    }

    // Final measurement
    await page.waitForTimeout(1000);
    await recordMemory('Final');

    printMemoryTable(samples);

    const baselineMemory = samples[0].usedMB;
    const finalMemory = samples[samples.length - 1].usedMB;
    const growthMB = finalMemory - baselineMemory;
    const growthPercent = ((finalMemory - baselineMemory) / baselineMemory) * 100;

    console.log(`Memory Growth Summary:`);
    console.log(`  Baseline: ${baselineMemory.toFixed(2)} MB`);
    console.log(`  Final:    ${finalMemory.toFixed(2)} MB`);
    console.log(`  Growth:   ${growthMB.toFixed(2)} MB (${growthPercent.toFixed(1)}%)`);

    if (growthPercent > 30) {
      console.warn('\nWARNING: Significant memory growth detected during hover interactions');
    }
  });

  test('stress test: repeated renderer creation/destruction', async ({ page }) => {
    const samples: MemorySample[] = [];

    const recordMemory = async (label: string) => {
      const info = await getMemoryInfo(page);
      samples.push({
        label,
        usedMB: info.usedJSHeapSize / 1024 / 1024,
        totalMB: info.totalJSHeapSize / 1024 / 1024,
        timestamp: Date.now(),
      });
    };

    // Start at Topics page
    await page.goto('/topics');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    await recordMemory('Initial Topics load');

    // Repeatedly navigate away and back (forces renderer cleanup/recreation)
    for (let i = 1; i <= 10; i++) {
      // Navigate away (renderer should be destroyed)
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      // Navigate back to Topics (renderer recreated)
      await page.goto('/topics');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      await recordMemory(`After cycle ${i}`);
    }

    // Final measurement after extra GC time
    await page.waitForTimeout(2000);
    await recordMemory('Final');

    printMemoryTable(samples);

    // Check for linear memory growth (indicates leak)
    const initialMemory = samples[0].usedMB;
    const midpoint = Math.floor(samples.length / 2);
    const firstHalfGrowth = samples[midpoint].usedMB - initialMemory;
    const secondHalfGrowth = samples[samples.length - 1].usedMB - samples[midpoint].usedMB;
    const totalGrowth = samples[samples.length - 1].usedMB - initialMemory;

    console.log(`\nGrowth Analysis:`);
    console.log(`  Initial memory:     ${initialMemory.toFixed(2)} MB`);
    console.log(`  First half growth:  ${firstHalfGrowth.toFixed(2)} MB`);
    console.log(`  Second half growth: ${secondHalfGrowth.toFixed(2)} MB`);
    console.log(`  Total growth:       ${totalGrowth.toFixed(2)} MB`);

    // If growth is roughly linear (second half grows as much as first), it's likely a leak
    if (totalGrowth > 5 && secondHalfGrowth > firstHalfGrowth * 0.5) {
      console.warn('\nWARNING: Linear memory growth pattern - likely memory leak in renderer cleanup');
    }
  });

  test('heap snapshot for detailed analysis', async ({ page }) => {
    const client = await page.context().newCDPSession(page);

    // Load Topics page
    await page.goto('/topics');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Take baseline snapshot
    console.log('Taking baseline heap snapshot...');
    await takeHeapSnapshot(client, 'heap-snapshot-baseline.heapsnapshot');

    const viewport = page.viewportSize() || { width: 1280, height: 720 };
    const centerX = viewport.width / 2;
    const centerY = viewport.height / 2;

    // Perform intensive interactions
    for (let i = 0; i < 10; i++) {
      // Zoom in and out
      await page.mouse.move(centerX, centerY);
      await page.mouse.wheel(0, -300);
      await page.waitForTimeout(100);
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(100);

      // Hover around
      await page.mouse.move(centerX + i * 20, centerY + i * 10);
      await page.waitForTimeout(50);
    }

    // Navigate away and back (tests cleanup)
    await page.goto('/');
    await page.waitForTimeout(1000);
    await page.goto('/topics');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Take after snapshot
    console.log('Taking comparison heap snapshot...');
    await takeHeapSnapshot(client, 'heap-snapshot-after.heapsnapshot');

    await client.detach();

    console.log('\nHeap snapshots saved. Load them in Chrome DevTools Memory panel for comparison.');
    console.log('Look for: Detached DOM trees, growing arrays, unreleased Three.js objects');
    console.log('\nTo compare snapshots:');
    console.log('1. Open Chrome DevTools > Memory');
    console.log('2. Load heap-snapshot-baseline.heapsnapshot');
    console.log('3. Load heap-snapshot-after.heapsnapshot');
    console.log('4. Select "Comparison" view to see retained objects');
  });
});
