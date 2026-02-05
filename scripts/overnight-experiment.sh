#!/bin/bash
# =============================================================================
# OVERNIGHT AI EXPERIMENT
# =============================================================================
# Two AI instances collaborate on Rise:
#   - BUILDER: Creates new features, fixes bugs, improves UX
#   - CRITIC: Reviews changes, finds issues, suggests improvements
#
# They communicate through git commits on a safe experimental branch.
#
# To run:   ./scripts/overnight-experiment.sh
# To stop:  Ctrl+C (your work is safe on main branch)
# To reset: git checkout main && git branch -D experimental/overnight
# =============================================================================

set -e

# Configuration
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BRANCH_NAME="experimental/overnight-$(date +%Y%m%d-%H%M%S)"
LOG_DIR="$PROJECT_DIR/scripts/logs"
LOG_FILE="$LOG_DIR/overnight-$(date +%Y%m%d-%H%M%S).log"
MAX_ITERATIONS=50  # Total cycles (25 builder + 25 critic)
DELAY_BETWEEN=15   # Seconds between iterations

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# =============================================================================
# SETUP
# =============================================================================

echo -e "${BLUE}==============================================================================${NC}"
echo -e "${BLUE}  OVERNIGHT AI EXPERIMENT - Rise 2.0${NC}"
echo -e "${BLUE}==============================================================================${NC}"
echo ""

cd "$PROJECT_DIR"
mkdir -p "$LOG_DIR"

# Safety check - make sure we're in the right place
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Not in a valid project directory${NC}"
    exit 1
fi

# Create experimental branch
echo -e "${GREEN}Creating safe experimental branch: ${BRANCH_NAME}${NC}"
git checkout -b "$BRANCH_NAME"

echo ""
echo -e "${GREEN}Logging to: ${LOG_FILE}${NC}"
echo ""
echo -e "${PURPLE}Press Ctrl+C at any time to stop. Your main branch is safe.${NC}"
echo ""
sleep 3

# =============================================================================
# PROMPTS
# =============================================================================

BUILDER_PROMPT='You are the BUILDER in an overnight AI experiment on Rise (a Next.js app).

Your job: Pick ONE small improvement and implement it fully.

Ideas to consider:
- Fix any bugs you notice in the codebase
- Improve error handling somewhere
- Add a small UX enhancement
- Improve accessibility
- Add helpful loading states
- Improve mobile responsiveness
- Add a micro-interaction or animation
- Refactor something for clarity
- Add input validation somewhere

Rules:
1. Pick ONE thing only - small and focused
2. Actually implement it (write the code)
3. Test that it makes sense (read files, check imports)
4. Commit your change with a clear message
5. Be creative but practical

Check git log to see what was done in previous iterations to avoid duplicating work.

Start by exploring, then pick your target, then implement and commit.'

CRITIC_PROMPT='You are the CRITIC in an overnight AI experiment on Rise (a Next.js app).

Your job: Review the latest changes and either improve them or fix issues.

Steps:
1. Run: git log --oneline -5 to see recent changes
2. Run: git diff HEAD~1 to see the last change in detail
3. Evaluate: Is it good? Any bugs? Could it be better?
4. Either:
   a) Fix any bugs or issues you find
   b) Improve/polish the implementation
   c) Add tests if missing
   d) If it looks good, find something else small to improve

Rules:
1. Be constructive - improve, dont just criticize
2. Make actual code changes
3. Commit your improvements with clear messages
4. Keep changes small and focused

Start by reviewing the recent commits, then take action.'

# =============================================================================
# MAIN LOOP
# =============================================================================

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

run_claude() {
    local role=$1
    local prompt=$2

    echo -e "\n${BLUE}========================================${NC}" | tee -a "$LOG_FILE"
    log "Starting $role iteration"
    echo -e "${BLUE}========================================${NC}\n" | tee -a "$LOG_FILE"

    # Run Claude Code
    claude --dangerously-skip-permissions --print "$prompt" 2>&1 | tee -a "$LOG_FILE"

    local exit_code=${PIPESTATUS[0]}

    if [ $exit_code -ne 0 ]; then
        log "Warning: Claude exited with code $exit_code"
    fi

    log "Completed $role iteration"
}

# Trap Ctrl+C to clean exit
cleanup() {
    echo ""
    echo -e "${PURPLE}==============================================================================${NC}"
    echo -e "${PURPLE}  EXPERIMENT STOPPED${NC}"
    echo -e "${PURPLE}==============================================================================${NC}"
    echo ""
    echo -e "Branch: ${GREEN}${BRANCH_NAME}${NC}"
    echo -e "Log: ${GREEN}${LOG_FILE}${NC}"
    echo ""
    echo "To see what was built:"
    echo "  git log --oneline main..HEAD"
    echo ""
    echo "To keep the changes:"
    echo "  git checkout main && git merge $BRANCH_NAME"
    echo ""
    echo "To discard everything:"
    echo "  git checkout main && git branch -D $BRANCH_NAME"
    echo ""
    exit 0
}
trap cleanup SIGINT SIGTERM

# Start the experiment
log "=== EXPERIMENT STARTED ==="
log "Branch: $BRANCH_NAME"
log "Max iterations: $MAX_ITERATIONS"

iteration=1
while [ $iteration -le $MAX_ITERATIONS ]; do
    echo ""
    echo -e "${GREEN}==============================================================================${NC}"
    echo -e "${GREEN}  ITERATION $iteration of $MAX_ITERATIONS${NC}"
    echo -e "${GREEN}==============================================================================${NC}"
    echo ""

    # Alternate between builder and critic
    if [ $((iteration % 2)) -eq 1 ]; then
        run_claude "BUILDER" "$BUILDER_PROMPT"
    else
        run_claude "CRITIC" "$CRITIC_PROMPT"
    fi

    # Show progress
    commit_count=$(git rev-list --count main..HEAD 2>/dev/null || echo "0")
    echo ""
    echo -e "${PURPLE}Progress: $commit_count commits so far${NC}"
    echo -e "${PURPLE}Waiting $DELAY_BETWEEN seconds before next iteration...${NC}"
    echo ""

    sleep $DELAY_BETWEEN
    iteration=$((iteration + 1))
done

log "=== EXPERIMENT COMPLETED ==="
cleanup
