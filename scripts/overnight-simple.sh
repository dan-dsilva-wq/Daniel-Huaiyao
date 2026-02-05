#!/bin/bash
# =============================================================================
# SIMPLE OVERNIGHT EXPERIMENT
# =============================================================================
# A simpler version - just one AI working iteratively.
# Easier to run, still gets creative results.
#
# To run:   bash scripts/overnight-simple.sh
# To stop:  Ctrl+C
# =============================================================================

cd "$(dirname "$0")/.."

BRANCH="experimental/overnight-$(date +%Y%m%d-%H%M%S)"
MAX_LOOPS=30
PAUSE=20

echo "Creating branch: $BRANCH"
git checkout -b "$BRANCH"

echo ""
echo "Starting experiment. Press Ctrl+C to stop."
echo "Your main branch is safe."
echo ""
sleep 2

PROMPT='You are improving Rise, an AI cofounder app (Next.js + Supabase).

1. First, run: git log --oneline -3
   to see what has been done recently.

2. Then pick ONE small improvement:
   - Fix a bug
   - Better error handling
   - UX polish
   - Accessibility improvement
   - Code cleanup
   - Add loading states
   - Mobile responsiveness
   - Micro-interactions

3. Implement it fully (read files, write code).

4. Commit with a clear message.

Be creative but focused. One thing at a time.'

for i in $(seq 1 $MAX_LOOPS); do
    echo ""
    echo "=========================================="
    echo "  Loop $i of $MAX_LOOPS"
    echo "=========================================="
    echo ""

    claude --dangerously-skip-permissions --print "$PROMPT"

    commits=$(git rev-list --count main..HEAD 2>/dev/null || echo 0)
    echo ""
    echo "Commits so far: $commits"
    echo "Pausing $PAUSE seconds..."
    sleep $PAUSE
done

echo ""
echo "Done! Check your commits with: git log --oneline main..HEAD"
