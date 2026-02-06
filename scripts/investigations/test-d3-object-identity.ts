/**
 * Test D3 force simulation's handling of custom object properties.
 * Verifies whether D3 preserves object identity and custom fields.
 */

import * as d3 from 'd3-force';

console.log('=== Testing D3 Simulation Object Identity ===\n');

const nodes = [
  { id: '1', x: 0, y: 0, customProp: 'value1' },
  { id: '2', x: 0, y: 0, customProp: 'value2' },
  { id: '3', x: 0, y: 0, customProp: 'value3' },
];

console.log('Original nodes:', nodes.map(n => ({ id: n.id, customProp: n.customProp })));
console.log('');

// Create simulation
const sim = d3.forceSimulation(nodes);
sim.tick();

const simNodes = sim.nodes();

// Test 1: Object identity
console.log('Test 1: Object Identity After 1 Tick');
console.log('  Node 0 same object?', nodes[0] === simNodes[0]);
console.log('  Node 1 same object?', nodes[1] === simNodes[1]);
console.log('  Node 2 same object?', nodes[2] === simNodes[2]);
console.log('');

// Test 2: Custom props preserved
console.log('Test 2: Custom Properties After 1 Tick');
console.log('  Props preserved?', simNodes.map((n: any) => n.customProp));
console.log('');

// Test 3: After multiple ticks
for (let i = 0; i < 100; i++) sim.tick();
const after100 = sim.nodes();

console.log('Test 3: After 100 Ticks');
console.log('  Node 0 still same object?', nodes[0] === after100[0]);
console.log('  Node 1 still same object?', nodes[1] === after100[1]);
console.log('  Node 2 still same object?', nodes[2] === after100[2]);
console.log('  Props still there?', after100.map((n: any) => n.customProp));
console.log('');

// Test 4: Check if any properties were added by D3
console.log('Test 4: D3-Added Properties');
const d3Props = Object.keys(after100[0]).filter(k => !['id', 'x', 'y', 'customProp'].includes(k));
console.log('  D3 added these properties:', d3Props);
console.log('');

// Conclusion
if (nodes[0] === after100[0] && (after100[0] as any).customProp === 'value1') {
  console.log('✅ CONCLUSION: D3 preserves object identity and custom properties');
} else {
  console.log('❌ CONCLUSION: D3 replaces objects or strips custom properties');
}
