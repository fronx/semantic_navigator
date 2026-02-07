/**
 * ESLint rule: no-unstable-ref-callbacks
 *
 * Detects inline arrow functions in JSX props that assign to refs.
 * This pattern causes components to recreate on every render.
 *
 * Bad:  onHover={(id) => { ref.current = id; callback(id); }}
 * Good: const stable = useStableCallback((id) => { ref.current = id; callback(id); })
 *       onHover={stable}
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow inline arrow functions that assign to refs',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      unstableRefCallback: 'Inline arrow function assigns to ref ({{refName}}). Use useStableCallback instead to prevent recreation on every render.',
    },
    schema: [],
  },

  create(context) {
    return {
      // Match: <Component prop={(args) => { ... }} />
      JSXAttribute(node) {
        const { value } = node;

        // Check if prop value is JSXExpressionContainer with ArrowFunctionExpression
        if (
          value?.type === 'JSXExpressionContainer' &&
          value.expression?.type === 'ArrowFunctionExpression'
        ) {
          const arrowFn = value.expression;
          const body = arrowFn.body;

          // Check function body for ref assignments (ref.current = ...)
          const hasRefAssignment = checkForRefAssignment(body);

          if (hasRefAssignment) {
            context.report({
              node: value,
              messageId: 'unstableRefCallback',
              data: {
                refName: hasRefAssignment,
              },
            });
          }
        }
      },
    };
  },
};

function checkForRefAssignment(node) {
  if (!node) return null;

  // Check single expression: ref.current = value
  if (node.type === 'AssignmentExpression') {
    const { left } = node;
    if (
      left.type === 'MemberExpression' &&
      left.object?.name?.endsWith('Ref') &&
      left.property?.name === 'current'
    ) {
      return left.object.name;
    }
  }

  // Check block statement: { ref.current = value; ... }
  if (node.type === 'BlockStatement') {
    for (const statement of node.body) {
      if (statement.type === 'ExpressionStatement') {
        const refName = checkForRefAssignment(statement.expression);
        if (refName) return refName;
      }
    }
  }

  return null;
}
