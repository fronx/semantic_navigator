import { describe, it, expect } from 'vitest';
import { computeVisibleKeywordIds, identifyAllMarginParents } from '../focus-mode-content-filter';
import type { FocusState } from '../focus-mode';
import type { KeywordNode } from '../graph-queries';
import type { ContentSimNode } from '../content-layout';

describe('computeVisibleKeywordIds', () => {
  const createKeywordNode = (id: string): KeywordNode => ({
    id,
    label: `Keyword ${id}`,
  });

  it('excludes margin keywords when focus active', () => {
    const activeNodes = [
      createKeywordNode('k1'),
      createKeywordNode('k2'),
      createKeywordNode('k3'),
    ];

    const focusState: FocusState = {
      focusedKeywordId: 'k1',
      focusedNodeIds: new Set(['k1', 'k2']),
      marginNodeIds: new Set(['k3']),
      keywordTiers: new Map(),
    };

    const result = computeVisibleKeywordIds(activeNodes, null, focusState);

    expect(result).toEqual(new Set(['k1', 'k2']));
    expect(result.has('k3')).toBe(false);
  });

  it('includes all keywords when no focus state', () => {
    const activeNodes = [
      createKeywordNode('k1'),
      createKeywordNode('k2'),
      createKeywordNode('k3'),
    ];

    const result = computeVisibleKeywordIds(activeNodes, null, null);

    expect(result).toEqual(new Set(['k1', 'k2', 'k3']));
  });

  it('uses chunkKeywordIds when semantic filter active', () => {
    const activeNodes = [
      createKeywordNode('k1'),
      createKeywordNode('k2'),
      createKeywordNode('k3'),
    ];

    const chunkKeywordIds = new Set(['k1', 'k3']);
    const focusState: FocusState = {
      focusedKeywordId: 'k1',
      focusedNodeIds: new Set(['k1', 'k2']),
      marginNodeIds: new Set(['k3']),
      keywordTiers: new Map(),
    };

    const result = computeVisibleKeywordIds(activeNodes, chunkKeywordIds, focusState);

    // Should use semantic filter, ignoring focus state
    expect(result).toEqual(new Set(['k1', 'k3']));
  });

  it('preserves Set immutability', () => {
    const activeNodes = [createKeywordNode('k1')];
    const chunkKeywordIds = new Set(['k1']);
    const focusState: FocusState = {
      focusedKeywordId: 'k1',
      focusedNodeIds: new Set(['k1']),
      marginNodeIds: new Set(),
      keywordTiers: new Map(),
    };

    const result1 = computeVisibleKeywordIds(activeNodes, chunkKeywordIds, focusState);
    const result2 = computeVisibleKeywordIds(activeNodes, chunkKeywordIds, focusState);

    expect(result1).not.toBe(chunkKeywordIds); // New Set created
    expect(result1).toEqual(chunkKeywordIds); // Same content
    expect(result1).not.toBe(result2); // Different instances
  });

  it('handles empty active nodes', () => {
    const result = computeVisibleKeywordIds([], null, null);
    expect(result).toEqual(new Set());
  });

  it('handles all keywords being margin', () => {
    const activeNodes = [
      createKeywordNode('k1'),
      createKeywordNode('k2'),
    ];

    const focusState: FocusState = {
      focusedKeywordId: 'none',
      focusedNodeIds: new Set(),
      marginNodeIds: new Set(['k1', 'k2']),
      keywordTiers: new Map(),
    };

    const result = computeVisibleKeywordIds(activeNodes, null, focusState);

    expect(result).toEqual(new Set()); // All excluded
  });
});

describe('identifyAllMarginParents', () => {
  const createContentNode = (id: string, parentIds: string[]): ContentSimNode => ({
    id,
    type: 'chunk',
    label: `Content ${id}`,
    parentIds,
    content: `Content ${id}`,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
  });

  it('identifies content with all parents margin-pushed', () => {
    const contentNodes = [
      createContentNode('c1', ['k1', 'k2']),
      createContentNode('c2', ['k3']),
      createContentNode('c3', ['k1', 'k3']),
    ];

    const focusPositions = new Map([
      ['k1', { x: 100, y: 100, z: 0 }],
      ['k2', { x: 100, y: 100, z: 0 }],
    ]);

    const result = identifyAllMarginParents(contentNodes, focusPositions);

    expect(result).toEqual(new Set(['c1'])); // Only c1 has ALL parents pushed
  });

  it('does NOT identify content with mixed parents', () => {
    const contentNodes = [
      createContentNode('c1', ['k1', 'k2', 'k3']),
    ];

    // k1 and k2 are margin-pushed, but k3 is not
    const focusPositions = new Map([
      ['k1', { x: 100, y: 100, z: 0 }],
      ['k2', { x: 100, y: 100, z: 0 }],
    ]);

    const result = identifyAllMarginParents(contentNodes, focusPositions);

    expect(result).toEqual(new Set()); // c1 has mixed parents, not excluded
  });

  it('returns empty set when no focus mode', () => {
    const contentNodes = [
      createContentNode('c1', ['k1', 'k2']),
      createContentNode('c2', ['k3']),
    ];

    const result = identifyAllMarginParents(contentNodes, null);

    expect(result).toEqual(new Set());
  });

  it('handles content with no parents', () => {
    const contentNodes = [
      createContentNode('c1', []),
    ];

    const focusPositions = new Map([
      ['k1', { x: 100, y: 100, z: 0 }],
    ]);

    const result = identifyAllMarginParents(contentNodes, focusPositions);

    // Content with no parents: every() returns true for empty array
    expect(result).toEqual(new Set(['c1']));
  });

  it('handles content with single parent', () => {
    const contentNodes = [
      createContentNode('c1', ['k1']),
      createContentNode('c2', ['k2']),
    ];

    const focusPositions = new Map([
      ['k1', { x: 100, y: 100, z: 0 }],
    ]);

    const result = identifyAllMarginParents(contentNodes, focusPositions);

    expect(result).toEqual(new Set(['c1'])); // c1's only parent is pushed
    expect(result.has('c2')).toBe(false); // c2's parent is not pushed
  });

  it('handles empty content nodes array', () => {
    const focusPositions = new Map([
      ['k1', { x: 100, y: 100, z: 0 }],
    ]);

    const result = identifyAllMarginParents([], focusPositions);

    expect(result).toEqual(new Set());
  });

  it('handles empty focus positions map', () => {
    const contentNodes = [
      createContentNode('c1', ['k1', 'k2']),
    ];

    const focusPositions = new Map();

    const result = identifyAllMarginParents(contentNodes, focusPositions);

    // No parents are pushed, so no content excluded
    expect(result).toEqual(new Set());
  });
});

describe('visibility logic integration', () => {
  const createKeywordNode = (id: string): KeywordNode => ({
    id,
    label: `Keyword ${id}`,
  });

  const createContentNode = (id: string, parentIds: string[]): ContentSimNode => ({
    id,
    type: 'chunk',
    label: `Content ${id}`,
    parentIds,
    content: `Content ${id}`,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
  });

  it('content hidden when all parents margin even if content-driven', () => {
    const activeNodes = [
      createKeywordNode('k1'),
      createKeywordNode('k2'),
      createKeywordNode('k3'),
    ];

    const contentNodes = [
      createContentNode('c1', ['k1', 'k2']), // All parents margin
      createContentNode('c2', ['k2', 'k3']), // Mixed parents
    ];

    const focusState: FocusState = {
      focusedKeywordId: 'k3',
      focusedNodeIds: new Set(['k3']),
      marginNodeIds: new Set(['k1', 'k2']),
      keywordTiers: new Map(),
    };

    const focusPositions = new Map([
      ['k1', { x: 100, y: 100, z: 0 }],
      ['k2', { x: 100, y: 100, z: 0 }],
    ]);

    const visibleKeywordIds = computeVisibleKeywordIds(activeNodes, null, focusState);
    const allMarginParentContent = identifyAllMarginParents(contentNodes, focusPositions);

    // Even in content-driven mode, c1 should be hidden (all parents margin)
    expect(allMarginParentContent.has('c1')).toBe(true);
    expect(allMarginParentContent.has('c2')).toBe(false);

    // Keywords k1, k2 are hidden
    expect(visibleKeywordIds.has('k1')).toBe(false);
    expect(visibleKeywordIds.has('k2')).toBe(false);
    expect(visibleKeywordIds.has('k3')).toBe(true);
  });

  it('content shown when has focused parent in content-driven mode', () => {
    const activeNodes = [
      createKeywordNode('k1'),
      createKeywordNode('k2'),
      createKeywordNode('k3'),
    ];

    const contentNodes = [
      createContentNode('c1', ['k1', 'k3']), // Has focused parent k3
      createContentNode('c2', ['k2']), // Only margin parent
    ];

    const focusState: FocusState = {
      focusedKeywordId: 'k3',
      focusedNodeIds: new Set(['k3']),
      marginNodeIds: new Set(['k1', 'k2']),
      keywordTiers: new Map(),
    };

    const focusPositions = new Map([
      ['k1', { x: 100, y: 100, z: 0 }],
      ['k2', { x: 100, y: 100, z: 0 }],
    ]);

    const visibleKeywordIds = computeVisibleKeywordIds(activeNodes, null, focusState);
    const allMarginParentContent = identifyAllMarginParents(contentNodes, focusPositions);

    // c1 has mixed parents (k1 margin, k3 focused), should be shown
    expect(allMarginParentContent.has('c1')).toBe(false);

    // c2 has only margin parent, should be hidden
    expect(allMarginParentContent.has('c2')).toBe(true);

    // k3 is visible
    expect(visibleKeywordIds.has('k3')).toBe(true);
  });

  it('semantic filter overrides focus mode for keywords', () => {
    const activeNodes = [
      createKeywordNode('k1'),
      createKeywordNode('k2'),
      createKeywordNode('k3'),
    ];

    const contentNodes = [
      createContentNode('c1', ['k1']),
    ];

    const focusState: FocusState = {
      focusedKeywordId: 'k2',
      focusedNodeIds: new Set(['k2']),
      marginNodeIds: new Set(['k1', 'k3']),
      keywordTiers: new Map(),
    };

    const chunkKeywordIds = new Set(['k1', 'k3']); // Semantic filter includes margin keywords

    const focusPositions = new Map([
      ['k1', { x: 100, y: 100, z: 0 }],
      ['k3', { x: 100, y: 100, z: 0 }],
    ]);

    const visibleKeywordIds = computeVisibleKeywordIds(activeNodes, chunkKeywordIds, focusState);
    const allMarginParentContent = identifyAllMarginParents(contentNodes, focusPositions);

    // Semantic filter shows k1 and k3 despite being margin
    expect(visibleKeywordIds).toEqual(new Set(['k1', 'k3']));

    // But content filtering still applies (c1's parent k1 is pushed)
    expect(allMarginParentContent.has('c1')).toBe(true);
  });

  it('no filtering when focus mode disabled', () => {
    const activeNodes = [
      createKeywordNode('k1'),
      createKeywordNode('k2'),
    ];

    const contentNodes = [
      createContentNode('c1', ['k1', 'k2']),
    ];

    const visibleKeywordIds = computeVisibleKeywordIds(activeNodes, null, null);
    const allMarginParentContent = identifyAllMarginParents(contentNodes, null);

    expect(visibleKeywordIds).toEqual(new Set(['k1', 'k2']));
    expect(allMarginParentContent).toEqual(new Set());
  });
});
