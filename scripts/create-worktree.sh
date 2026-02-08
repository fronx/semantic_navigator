#!/bin/bash
# Create a git worktree with a new branch, ready to run.
# Usage: ./scripts/create-worktree.sh <branch-name>

set -e

BRANCH="$1"
if [ -z "$BRANCH" ]; then
  echo "Usage: $0 <branch-name>"
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_DIR="$(dirname "$REPO_ROOT")/$(basename "$REPO_ROOT")-${BRANCH}"

if [ -d "$WORKTREE_DIR" ]; then
  echo "Worktree already exists at $WORKTREE_DIR"
  exit 1
fi

echo "Creating worktree at $WORKTREE_DIR on branch $BRANCH..."
git worktree add "$WORKTREE_DIR" -b "$BRANCH"

# Symlink .env.local so credentials are shared
if [ -f "$REPO_ROOT/.env.local" ]; then
  ln -s "$REPO_ROOT/.env.local" "$WORKTREE_DIR/.env.local"
  echo "Symlinked .env.local"
fi

# Install dependencies
echo "Installing dependencies..."
(cd "$WORKTREE_DIR" && npm install --silent)

echo ""
echo "Ready: $WORKTREE_DIR"
echo "  cd $WORKTREE_DIR && npm run dev"
