# =============================================================================
# SIMPLE OVERNIGHT EXPERIMENT - PowerShell Version
# =============================================================================
# To run:   .\scripts\overnight-simple.ps1
# To stop:  Ctrl+C
# =============================================================================

$ErrorActionPreference = "Continue"  # Don't stop on errors

# Prevent system sleep during experiment
$code = @'
[DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
$ES_CONTINUOUS = 0x80000000
$ES_SYSTEM_REQUIRED = 0x00000001
$ES_DISPLAY_REQUIRED = 0x00000002
try {
    $sleepUtil = Add-Type -MemberDefinition $code -Name "SleepUtil" -Namespace "Win32" -PassThru
    $sleepUtil::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED -bor $ES_DISPLAY_REQUIRED) | Out-Null
    Write-Host "Sleep prevention enabled" -ForegroundColor Green
} catch {
    Write-Host "Could not disable sleep - consider adjusting power settings" -ForegroundColor Yellow
}

# Move to project root
Set-Location $PSScriptRoot\..

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BRANCH = "experimental/overnight-$timestamp"
$MAIN_BRANCH = "master"  # Your main branch name
$MAX_LOOPS = 30
$PAUSE = 30  # Longer pause to avoid rate limits
$MAX_RETRIES = 3

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  OVERNIGHT AI EXPERIMENT" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Creating branch: $BRANCH" -ForegroundColor Green

git checkout -b $BRANCH

Write-Host ""
Write-Host "Starting experiment. Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host "Your main branch is safe." -ForegroundColor Yellow
Write-Host ""
Start-Sleep -Seconds 3

$PROMPT = @"
You are improving Rise, an AI cofounder app (Next.js + Supabase).

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

Be creative but focused. One thing at a time.
"@

for ($i = 1; $i -le $MAX_LOOPS; $i++) {
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host "  Loop $i of $MAX_LOOPS" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host ""

    # Run Claude Code with retry logic
    $retry = 0
    $success = $false
    while (-not $success -and $retry -lt $MAX_RETRIES) {
        try {
            claude --dangerously-skip-permissions --print $PROMPT
            $success = $true
        } catch {
            $retry++
            Write-Host "Error occurred, retry $retry of $MAX_RETRIES..." -ForegroundColor Yellow
            Start-Sleep -Seconds 30
        }
    }
    if (-not $success) {
        Write-Host "Failed after $MAX_RETRIES retries, continuing to next loop..." -ForegroundColor Red
    }

    # Count commits (ignore errors)
    try {
        $commits = git rev-list --count master..HEAD 2>&1 | Select-Object -First 1
        if ($commits -notmatch '^\d+$') { $commits = "?" }
    } catch {
        $commits = "?"
    }

    Write-Host ""
    Write-Host "Commits so far: $commits" -ForegroundColor Magenta
    Write-Host "Pausing $PAUSE seconds..." -ForegroundColor Magenta
    Start-Sleep -Seconds $PAUSE
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  EXPERIMENT COMPLETE" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "See what was built: git log --oneline master..HEAD" -ForegroundColor Yellow
