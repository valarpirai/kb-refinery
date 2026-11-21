#!/usr/bin/env bash
# Syncs `now-sdk transform`'s pull of live instance state into fluent source
# via a real git 3-way merge against a tracked baseline tag, instead of a
# blind overwrite.
#
# Why this exists: a plain `now-sdk transform` regenerates fluent source
# files straight from the instance, discarding any undeployed local edits to
# those same files with no diff/merge at all -- and the opposite direction
# (`now-sdk install`) does the same thing to the instance, discarding any
# manual instance-side edits. Neither tool reconciles; this script makes the
# instance-pull side a real merge:
#   - a field you changed in source and a field someone changed on the
#     instance, on different lines, merge automatically (git's ordinary
#     3-way line merge)
#   - a field changed on BOTH sides since the last sync surfaces as a normal
#     git merge conflict for you to resolve by hand -- that decision (which
#     side's intent should win) is not something a script can make for you
#
# Usage: pnpm run sync:transform   (or: bash scripts/sync-transform.sh)
#
# Requires a clean working tree -- commit your local fluent source edits
# first. The first run bootstraps the baseline tag at the current commit,
# which assumes committed source already matches the instance; if it
# doesn't, the first merge may fold in stale differences -- review it before
# trusting it as a real sync point going forward.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

BASELINE_TAG="fluent-transform-baseline"
STRIP_SCRIPT="docs/examples/strip-prompt-template-boilerplate.mjs"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is not clean." >&2
  echo "Commit or discard your changes first -- the merge below treats your current commit as 'ours', so anything uncommitted would just be silently left behind on the branch switch." >&2
  exit 1
fi

ORIGINAL_BRANCH="$(git symbolic-ref --short -q HEAD || true)"
if [[ -z "$ORIGINAL_BRANCH" ]]; then
  echo "error: HEAD is detached -- run this from a real branch." >&2
  exit 1
fi
ORIGINAL_COMMIT="$(git rev-parse HEAD)"

# Only ever resets/cleans while HEAD is detached on the throwaway transform
# checkout below -- that state holds nothing but a fresh `now-sdk transform`
# pull, never the user's real work (which lives on $ORIGINAL_BRANCH and was
# already verified clean above), so discarding it on a failure path is safe.
cleanup() {
  local exit_code=$?
  local current_branch
  current_branch="$(git symbolic-ref --short -q HEAD || true)"
  if [[ "$current_branch" != "$ORIGINAL_BRANCH" ]]; then
    echo "Cleaning up throwaway transform checkout and restoring '$ORIGINAL_BRANCH'..." >&2
    git reset --hard >/dev/null 2>&1 || true
    git clean -fd >/dev/null 2>&1 || true
    git checkout "$ORIGINAL_BRANCH" >/dev/null 2>&1 || true
  fi
  exit $exit_code
}
trap cleanup EXIT

if ! git rev-parse -q --verify "refs/tags/$BASELINE_TAG" >/dev/null; then
  echo "No '$BASELINE_TAG' tag yet -- creating it at the current commit ($ORIGINAL_COMMIT)."
  echo "This assumes committed source right now already matches the instance. If it doesn't, double-check the first merge below rather than trusting it blindly."
  git tag "$BASELINE_TAG" "$ORIGINAL_COMMIT"
fi

echo "Checking out baseline '$BASELINE_TAG' to pull a clean instance snapshot..."
git checkout --detach "$BASELINE_TAG"

echo "Running now-sdk transform..."
pnpm exec now-sdk transform

if [[ -f "$STRIP_SCRIPT" ]]; then
  echo "Stripping known boilerplate fields (sys_customer_update / sys_replace_on_upgrade)..."
  node "$STRIP_SCRIPT"
fi

if [[ -z "$(git status --porcelain)" ]]; then
  echo "Instance state matches the baseline already -- nothing new to sync."
  git checkout "$ORIGINAL_BRANCH"
  exit 0
fi

git add -A
git commit -q -m "transform: sync fluent source from instance state"
NEW_SNAPSHOT="$(git rev-parse HEAD)"
git tag -f "$BASELINE_TAG" "$NEW_SNAPSHOT" >/dev/null

echo "New instance snapshot committed ($NEW_SNAPSHOT). Merging into '$ORIGINAL_BRANCH'..."
git checkout "$ORIGINAL_BRANCH"

if git merge --no-ff -m "Merge instance transform sync into $ORIGINAL_BRANCH" "$BASELINE_TAG"; then
  echo "Merged cleanly -- non-overlapping changes from source and the instance were combined automatically."
else
  echo
  echo "Merge conflicts -- these fields were changed BOTH in your undeployed source AND on the instance since the last sync:" >&2
  git diff --name-only --diff-filter=U
  echo
  echo "Resolve the conflict markers by hand, then 'git add <file>...' and 'git commit' to finish the merge." >&2
  exit 1
fi
