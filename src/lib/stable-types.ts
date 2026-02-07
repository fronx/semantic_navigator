/**
 * TypeScript branded types to enforce callback stability.
 *
 * Use StableCallback<T> for props that MUST NOT change on every render.
 * This forces callers to explicitly wrap with useStableCallback.
 */

declare const StableBrand: unique symbol;

/**
 * A callback that is guaranteed to be stable across re-renders.
 *
 * To create a StableCallback, use:
 *   const stable = useStableCallback(callback) as StableCallback<typeof callback>;
 *
 * Or better yet, use the helper:
 *   const stable = makeStableCallback(callback);
 */
export type StableCallback<T extends (...args: any[]) => any> = T & {
  [StableBrand]: true;
};

/**
 * Helper to create a stable callback with proper typing.
 *
 * Usage:
 *   const stableOnClick = makeStableCallback((id: string) => {
 *     // ... handler logic
 *   });
 */
export function makeStableCallback<T extends (...args: any[]) => any>(
  callback: T
): StableCallback<T> {
  // This is a runtime identity function - the real stability comes from
  // useStableCallback which the caller must use before calling this.
  // This function just adds the type brand.
  return callback as StableCallback<T>;
}

/**
 * Example usage in component props:
 *
 * interface MyComponentProps {
 *   // Regular callback - can change on every render
 *   onRegularClick?: (id: string) => void;
 *
 *   // Stable callback - must be wrapped with useStableCallback
 *   onStableClick: StableCallback<(id: string) => void>;
 * }
 *
 * // In parent component:
 * const stableClick = useStableCallback((id: string) => {
 *   console.log('clicked', id);
 * });
 *
 * return <MyComponent onStableClick={makeStableCallback(stableClick)} />;
 */
