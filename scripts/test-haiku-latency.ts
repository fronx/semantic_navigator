/**
 * Test Haiku latency to understand cold vs warm connection times.
 *
 * Usage: npm run script scripts/test-haiku-latency.ts
 */
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function timeRequest(label: string) {
  const start = performance.now();
  await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 50,
    messages: [{ role: "user", content: "Say 'hello' and nothing else." }],
  });
  const elapsed = performance.now() - start;
  console.log(`${label}: ${elapsed.toFixed(0)}ms`);
  return elapsed;
}

async function main() {
  console.log("Testing Haiku latency (minimal request)...\n");

  const times: number[] = [];

  // Cold start
  times.push(await timeRequest("Request 1 (cold)"));

  // Subsequent requests (connection reused via SDK pooling)
  times.push(await timeRequest("Request 2 (warm)"));
  times.push(await timeRequest("Request 3 (warm)"));
  times.push(await timeRequest("Request 4 (warm)"));
  times.push(await timeRequest("Request 5 (warm)"));

  console.log("\n--- Summary ---");
  console.log(`Cold start:     ${times[0].toFixed(0)}ms`);
  console.log(`Warm average:   ${(times.slice(1).reduce((a, b) => a + b, 0) / 4).toFixed(0)}ms`);
  console.log(`Warm savings:   ${(times[0] - times.slice(1).reduce((a, b) => a + b, 0) / 4).toFixed(0)}ms`);
}

main().catch(console.error);
