/**
 * Verification script for wheel event forwarding fix.
 * Checks if the useWheelEventForwarding hook is properly implemented
 * and used in R3FTopicsCanvas.
 */

import fs from "fs";
import path from "path";

const HOOK_FILE = path.join(
  process.cwd(),
  "src/hooks/useWheelEventForwarding.ts"
);

const CANVAS_FILE = path.join(
  process.cwd(),
  "src/components/topics-r3f/R3FTopicsCanvas.tsx"
);

function verifyHookImplementation(): boolean {
  if (!fs.existsSync(HOOK_FILE)) {
    console.error("❌ FAIL: Hook file does not exist");
    return false;
  }

  const content = fs.readFileSync(HOOK_FILE, "utf-8");

  // Check 1: Has wheel event listener
  const hasListener = content.includes('container.addEventListener("wheel"') ||
                     content.includes("container.addEventListener('wheel'");

  if (!hasListener) {
    console.error("❌ FAIL: No wheel event listener in hook");
    return false;
  }

  // Check 2: Forwards events to target
  const forwardsEvents = content.includes("target.dispatchEvent") ||
                        content.includes("canvas.dispatchEvent");

  if (!forwardsEvents) {
    console.error("❌ FAIL: No event forwarding in hook");
    return false;
  }

  // Check 3: Creates synthetic WheelEvent
  const createsSyntheticEvent = content.includes("new WheelEvent");

  if (!createsSyntheticEvent) {
    console.error("❌ FAIL: No synthetic WheelEvent creation in hook");
    return false;
  }

  // Check 4: Prevents default browser behavior
  const preventsDefault = content.includes("e.preventDefault()");

  if (!preventsDefault) {
    console.error("❌ FAIL: No preventDefault in hook");
    return false;
  }

  // Check 5: Includes modifier keys
  const hasModifierKeys = content.includes("ctrlKey") &&
                         content.includes("shiftKey");

  if (!hasModifierKeys) {
    console.warn("⚠️  WARNING: Modifier keys not included (might affect gestures)");
  }

  console.log("✅ Hook implementation: ✓");
  return true;
}

function verifyHookUsage(): boolean {
  if (!fs.existsSync(CANVAS_FILE)) {
    console.error("❌ FAIL: Canvas file does not exist");
    return false;
  }

  const content = fs.readFileSync(CANVAS_FILE, "utf-8");

  // Check 1: Imports the hook
  const importsHook = content.includes("useWheelEventForwarding");

  if (!importsHook) {
    console.error("❌ FAIL: Hook not imported in R3FTopicsCanvas");
    return false;
  }

  // Check 2: Calls the hook with containerRef
  const usesHook = content.includes("useWheelEventForwarding(containerRef");

  if (!usesHook) {
    console.error("❌ FAIL: Hook not called with containerRef");
    return false;
  }

  console.log("✅ Hook usage: ✓");
  return true;
}

// Run verification
console.log("Verifying wheel event forwarding implementation...\n");

const hookValid = verifyHookImplementation();
const usageValid = verifyHookUsage();

if (hookValid && usageValid) {
  console.log("\n✅ PASS: Wheel event forwarding fully implemented");
  console.log("  - Hook implementation: ✓");
  console.log("  - Hook usage in R3FTopicsCanvas: ✓");
  console.log("  - Event forwarding: ✓");
  console.log("  - Prevents default: ✓");
  process.exit(0);
} else {
  console.log("\n❌ FAIL: Wheel event forwarding incomplete");
  process.exit(1);
}
