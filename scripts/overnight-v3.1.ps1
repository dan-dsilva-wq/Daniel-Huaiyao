# =============================================================================
# OVERNIGHT AI EXPERIMENT v3.1 - Self-Improving (Hardened)
# =============================================================================
# Usage:
#   .\scripts\overnight-v3.1.ps1                           # Default run
#   .\scripts\overnight-v3.1.ps1 -MaxLoops 5               # Short test
#   .\scripts\overnight-v3.1.ps1 -Goal "Make it awesome"   # Goal mode
#   .\scripts\overnight-v3.1.ps1 -UseVision                # Use vision file
#   .\scripts\overnight-v3.1.ps1 -DryRun                   # Test without changes
#
# Configuration: Edit project-config.json and product-vision.txt for your project
# =============================================================================

param(
    [string]$TaskFile = "tasks.json",
    [string]$RiskLevel = "low",
    [int]$MaxLoops = 30,
    [string]$Goal = "",
    [switch]$UseVision = $false,
    [switch]$DryRun = $false,
    [ValidateSet("high", "medium", "low", "adaptive")]
    [string]$Boldness = "adaptive"
)

$ErrorActionPreference = "Continue"

# =============================================================================
# PATHS
# =============================================================================

# $PSScriptRoot can be empty when running via powershell -Command, so fallback to script path
$SCRIPT_DIR = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $SCRIPT_DIR) { $SCRIPT_DIR = "." }
$PROJECT_ROOT = (Resolve-Path "$SCRIPT_DIR\..").Path
$CONFIG_FILE = "$SCRIPT_DIR\project-config.json"
$STATE_FILE = "$SCRIPT_DIR\state.json"
$TASK_FILE = "$SCRIPT_DIR\$TaskFile"
$LOG_DIR = "$SCRIPT_DIR\logs"
$REPORT_DIR = "$SCRIPT_DIR\reports"
$RUN_HISTORY_FILE = "$SCRIPT_DIR\run-history.json"

$TIMESTAMP = Get-Date -Format "yyyyMMdd-HHmmss"
$DATE_STAMP = Get-Date -Format "yyyyMMdd"
$LOG_FILE = "$LOG_DIR\overnight-$DATE_STAMP.log"
$REPORT_FILE = "$REPORT_DIR\overnight-report-$DATE_STAMP.md"

# =============================================================================
# HELPERS
# =============================================================================

function Write-Log {
    param([string]$Message, [string]$Color = "White")
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$ts] $Message"
    Write-Host $logMessage -ForegroundColor $Color
    if ($LOG_FILE) { Add-Content -Path $LOG_FILE -Value $logMessage -ErrorAction SilentlyContinue }
}

function Write-Banner {
    param([string]$Text)
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host ""
}

# Progress tracking
$script:CurrentPhase = ""
$script:PhaseStartTime = $null
$script:SpinnerChars = @('|', '/', '-', '\')
$script:SpinnerIndex = 0

function Write-Phase {
    param([string]$Phase, [string]$Detail = "")
    $script:CurrentPhase = $Phase
    $script:PhaseStartTime = Get-Date
    $elapsed = ""
    $detailText = if ($Detail) { " - $Detail" } else { "" }
    Write-Host ""
    Write-Host "[$Phase]$detailText" -ForegroundColor Magenta -NoNewline
    Write-Host ""
}

function Write-PhaseStep {
    param([string]$Step, [int]$Current, [int]$Total)
    $pct = [math]::Round(($Current / $Total) * 100)
    $bar = "[" + ("=" * [math]::Floor($pct / 5)) + (" " * (20 - [math]::Floor($pct / 5))) + "]"
    Write-Host "  $bar $pct% - $Step" -ForegroundColor Gray
}

function Write-Spinner {
    param([string]$Message)
    $char = $script:SpinnerChars[$script:SpinnerIndex % 4]
    $script:SpinnerIndex++
    Write-Host "`r  $char $Message" -NoNewline -ForegroundColor Yellow
}

function Write-SpinnerDone {
    param([string]$Message, [bool]$Success = $true)
    $symbol = if ($Success) { "[OK]" } else { "[X]" }
    $color = if ($Success) { "Green" } else { "Red" }
    Write-Host "`r  $symbol $Message     " -ForegroundColor $color
}

function Write-LoopProgress {
    param([int]$Loop, [int]$MaxLoops, $State)
    $pct = [math]::Round(($Loop / $MaxLoops) * 100)
    $commits = $State.totalCommits
    $completed = $State.completedTasks.Count
    $failed = $State.failedTasks.Count

    Write-Host ""
    Write-Host "============================================" -ForegroundColor DarkCyan
    Write-Host " LOOP $Loop / $MaxLoops ($pct%)" -ForegroundColor White -NoNewline
    Write-Host " | Commits: $commits | Done: $completed | Failed: $failed" -ForegroundColor DarkGray
    Write-Host "============================================" -ForegroundColor DarkCyan
}

function Enable-SleepPrevention {
    $code = @'
[DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
    try {
        $sleepUtil = Add-Type -MemberDefinition $code -Name "SleepUtil" -Namespace "Win32" -PassThru -ErrorAction SilentlyContinue
        $sleepUtil::SetThreadExecutionState(0x80000000 -bor 0x00000001 -bor 0x00000002) | Out-Null
        Write-Log "Sleep prevention enabled" "Green"
    } catch {
        Write-Log "Could not disable sleep" "Yellow"
    }
}

function ConvertTo-Hashtable {
    param($InputObject)
    if ($null -eq $InputObject) { return @{} }
    if ($InputObject -is [System.Collections.IEnumerable] -and $InputObject -isnot [string]) {
        $collection = @(foreach ($object in $InputObject) { ConvertTo-Hashtable $object })
        return ,$collection
    } elseif ($InputObject -is [PSCustomObject]) {
        $hash = @{}
        foreach ($property in $InputObject.PSObject.Properties) {
            $hash[$property.Name] = ConvertTo-Hashtable $property.Value
        }
        return $hash
    } else {
        return $InputObject
    }
}

# =============================================================================
# CONFIGURATION
# =============================================================================

function Load-ProjectConfig {
    if (-not (Test-Path $CONFIG_FILE)) {
        Write-Log "No project-config.json found - creating default" "Yellow"
        $defaultConfig = @{
            project = @{
                name = "MyProject"
                description = "A software project"
                techStack = "JavaScript"
                visionFile = "product-vision.txt"
            }
            qualityGates = @{
                enabled = $true
                commands = @{
                    typecheck = "npx tsc --noEmit"
                    lint = "npm run lint"
                    build = "npm run build"
                }
            }
            git = @{
                mainBranch = "main"
                branchPrefix = "experimental/overnight"
            }
            safety = @{
                maxFilesPerTask = 3
                maxConsecutiveFailures = 3
                maxConsecutiveNoOps = 3
                blockedPatterns = @(
                    "\.env", "package-lock\.json", "yarn\.lock",
                    "pnpm-lock\.yaml", "\.prisma", "schema\.prisma",
                    "migrations/", "\.secret", "credentials", "node_modules/",
                    "public/sw\.js"
                )
            }
            timing = @{
                pauseSeconds = 30
                maxRetries = 3
            }
        }
        $defaultConfig | ConvertTo-Json -Depth 10 | Set-Content $CONFIG_FILE
        return $defaultConfig
    }
    # Explicitly build config hashtable to avoid PSCustomObject nesting issues
    $json = Get-Content $CONFIG_FILE -Raw | ConvertFrom-Json
    return @{
        project = @{
            name = $json.project.name
            description = $json.project.description
            techStack = $json.project.techStack
            visionFile = $json.project.visionFile
        }
        qualityGates = @{
            enabled = $json.qualityGates.enabled
            commands = @{
                typecheck = $json.qualityGates.commands.typecheck
                lint = $json.qualityGates.commands.lint
                build = $json.qualityGates.commands.build
            }
        }
        git = @{
            mainBranch = $json.git.mainBranch
            branchPrefix = $json.git.branchPrefix
        }
        safety = @{
            maxFilesPerTask = $json.safety.maxFilesPerTask
            maxConsecutiveFailures = $json.safety.maxConsecutiveFailures
            maxConsecutiveNoOps = $json.safety.maxConsecutiveNoOps
            blockedPatterns = @($json.safety.blockedPatterns)
        }
        timing = @{
            pauseSeconds = $json.timing.pauseSeconds
            maxRetries = $json.timing.maxRetries
        }
    }
}

function Load-Vision {
    param($config)
    $visionPath = "$SCRIPT_DIR\$($config.project.visionFile)"
    if (Test-Path $visionPath) {
        return Get-Content $visionPath -Raw
    }
    return ""
}

# =============================================================================
# STATE MANAGEMENT
# =============================================================================

function Initialize-State {
    $state = @{
        startedAt = (Get-Date).ToString("o")
        currentLoop = 0
        completedTasks = @()
        failedTasks = @()
        skippedTasks = @()
        consecutiveFailures = 0
        consecutiveNoOps = 0
        totalCommits = 0
        observations = @()
        reviewRequired = @()
        lastOutput = ""
        lastFailure = ""
        loopCompletions = @()
    }
    Save-State $state
    return $state
}

function Load-State {
    if (Test-Path $STATE_FILE) {
        $state = Get-Content $STATE_FILE -Raw | ConvertFrom-Json | ConvertTo-Hashtable
        # Ensure new fields exist for backward compatibility
        if (-not $state.ContainsKey('lastOutput')) { $state.lastOutput = "" }
        if (-not $state.ContainsKey('lastFailure')) { $state.lastFailure = "" }
        if (-not $state.ContainsKey('loopCompletions')) { $state.loopCompletions = @() }
        # Ensure arrays are not null
        if ($null -eq $state.observations) { $state.observations = @() }
        if ($null -eq $state.completedTasks) { $state.completedTasks = @() }
        if ($null -eq $state.failedTasks) { $state.failedTasks = @() }
        if ($null -eq $state.skippedTasks) { $state.skippedTasks = @() }
        if ($null -eq $state.reviewRequired) { $state.reviewRequired = @() }
        if ($null -eq $state.loopCompletions) { $state.loopCompletions = @() }
        return $state
    }
    return Initialize-State
}

function Save-State {
    param($state)
    $state | ConvertTo-Json -Depth 10 | Set-Content $STATE_FILE
}

function Add-Observation {
    param($state, [string]$observation)
    $loopNum = $state.currentLoop
    $state.observations += "Loop ${loopNum}: $observation"
    Save-State $state
}

# =============================================================================
# TASK QUEUE
# =============================================================================

function Load-Tasks {
    param($config)
    if (-not (Test-Path $TASK_FILE)) {
        Write-Log "No task file found - creating default" "Yellow"
        $defaultTasks = @{
            tasks = @(
                @{ id = "1"; description = "Add hover states to interactive components"; risk = "low"; status = "pending"; maxFiles = 3 }
                @{ id = "2"; description = "Improve error messages in forms"; risk = "low"; status = "pending"; maxFiles = 3 }
                @{ id = "3"; description = "Add loading states to async operations"; risk = "low"; status = "pending"; maxFiles = 3 }
            )
            config = @{
                riskLevel = "low"
                maxFilesPerTask = $config.safety.maxFilesPerTask
            }
        }
        $defaultTasks | ConvertTo-Json -Depth 10 | Set-Content $TASK_FILE
        return $defaultTasks
    }
    return Get-Content $TASK_FILE -Raw | ConvertFrom-Json | ConvertTo-Hashtable
}

function Save-Tasks {
    param($taskData)
    $taskData | ConvertTo-Json -Depth 10 | Set-Content $TASK_FILE
}

function Get-NextTask {
    param($taskData, [string]$riskLevel)
    $riskOrder = @{ "low" = 1; "medium" = 2; "high" = 3 }
    foreach ($task in $taskData.tasks) {
        if ($task.status -eq "pending") {
            $taskRisk = if ($task.risk) { $task.risk } else { "low" }
            if ($riskOrder[$taskRisk] -le $riskOrder[$riskLevel]) {
                return $task
            }
        }
    }
    return $null
}

function Update-TaskStatus {
    param($taskData, [string]$taskId, [string]$status)
    foreach ($task in $taskData.tasks) {
        if ($task.id -eq $taskId) {
            $task.status = $status
            break
        }
    }
    Save-Tasks $taskData
}

# =============================================================================
# QUALITY GATES
# =============================================================================

function Invoke-QualityGate {
    param([string]$name, [string]$command, $config)

    if (-not $config.qualityGates.enabled) { return @{ passed = $true; error = "" } }
    if (-not $command) { return @{ passed = $true; error = "" } }

    Write-Log "Running $name..." "Yellow"
    Push-Location $PROJECT_ROOT
    try {
        $output = Invoke-Expression $command 2>&1
        $outputStr = if ($output -is [array]) { $output -join "`n" } else { "$output" }
        if ($LASTEXITCODE -eq 0) {
            Write-Log "$name passed" "Green"
            return @{ passed = $true; error = "" }
        } else {
            Write-Log "$name FAILED" "Red"
            $errorMsg = if ($outputStr.Length -gt 1500) { $outputStr.Substring(0, 1500) + "..." } else { $outputStr }
            return @{ passed = $false; error = "$name failed:`n$errorMsg" }
        }
    } finally {
        Pop-Location
    }
}

function Invoke-QualityGates {
    param($config)
    Write-Phase "QUALITY GATES" "Verifying code"

    $commands = $config.qualityGates.commands
    $totalGates = 3
    $currentGate = 0

    $currentGate++
    Write-PhaseStep "TypeScript check" $currentGate $totalGates
    $result = Invoke-QualityGate "TypeScript" $commands.typecheck $config
    if (-not $result.passed) { return @{ passed = $false; error = $result.error } }

    $currentGate++
    Write-PhaseStep "Lint check" $currentGate $totalGates
    $result = Invoke-QualityGate "Lint" $commands.lint $config
    if (-not $result.passed) { return @{ passed = $false; error = $result.error } }

    $currentGate++
    Write-PhaseStep "Build check" $currentGate $totalGates
    $result = Invoke-QualityGate "Build" $commands.build $config
    if (-not $result.passed) { return @{ passed = $false; error = $result.error } }

    Write-SpinnerDone "All quality gates passed!" $true
    return @{ passed = $true; error = "" }
}

# =============================================================================
# GIT OPERATIONS
# =============================================================================

function Get-ChangedFiles {
    Push-Location $PROJECT_ROOT
    try {
        $files = git diff --name-only 2>&1
        return $files -split "`n" | Where-Object { $_ -ne "" }
    } finally {
        Pop-Location
    }
}

function Test-FileAllowed {
    param([string]$file, $config)
    foreach ($pattern in $config.safety.blockedPatterns) {
        if ($file -match $pattern) { return $false }
    }
    return $true
}

function Invoke-SmartStaging {
    param($config)
    $changedFiles = @(Get-ChangedFiles)
    if ($null -eq $changedFiles) { $changedFiles = @() }
    $stagedFiles = @()
    $blockedFiles = @()
    $maxFiles = $config.safety.maxFilesPerTask

    Push-Location $PROJECT_ROOT
    try {
        foreach ($file in $changedFiles) {
            if (Test-FileAllowed $file $config) {
                if ($stagedFiles.Count -lt $maxFiles) {
                    git add $file 2>&1 | Out-Null
                    $stagedFiles += $file
                    Write-Log "Staged: $file" "Green"
                } else {
                    Write-Log "Skipped (limit): $file" "Yellow"
                }
            } else {
                $blockedFiles += $file
                Write-Log "Blocked: $file" "Red"
            }
        }
    } finally {
        Pop-Location
    }

    return @{
        staged = $stagedFiles
        blocked = $blockedFiles
        exceededLimit = ($changedFiles.Count -gt $maxFiles)
    }
}

function Invoke-Revert {
    Write-Log "Reverting changes..." "Yellow"
    Push-Location $PROJECT_ROOT
    try {
        git checkout . 2>&1 | Out-Null
        git clean -fd 2>&1 | Out-Null
        Write-Log "Changes reverted" "Green"
    } finally {
        Pop-Location
    }
}

function Invoke-Commit {
    param([string]$message)
    Push-Location $PROJECT_ROOT
    try {
        git commit -m $message 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Log "Committed: $message" "Green"
            return $true
        }
        return $false
    } finally {
        Pop-Location
    }
}

function Get-CommitCount {
    param($config)
    Push-Location $PROJECT_ROOT
    try {
        $mainBranch = $config.git.mainBranch
        $count = git rev-list --count "${mainBranch}..HEAD" 2>&1
        if ($count -match '^\d+$') { return [int]$count }
        return 0
    } finally {
        Pop-Location
    }
}

# =============================================================================
# CONTEXT GENERATION - Feed knowledge between loops (v2.5)
# =============================================================================

function Generate-CodebaseManifest {
    Push-Location $PROJECT_ROOT
    try {
        # Compact file tree grouped by directory
        $files = git ls-files -- 'src/' 2>&1
        if (-not $files) { return "" }

        $lines = @()
        $lines += "CODEBASE STRUCTURE (src/):"
        $lines += ""

        # Group by top-level directory
        $grouped = @{}
        foreach ($f in ($files -split "`n")) {
            $f = $f.Trim()
            if (-not $f -or -not $f.StartsWith("src/")) { continue }
            # Get directory path (2 levels deep)
            $parts = $f -split "/"
            $dir = if ($parts.Count -ge 3) { "$($parts[0])/$($parts[1])/$($parts[2])" } else { "$($parts[0])/$($parts[1])" }
            if (-not $grouped.ContainsKey($dir)) { $grouped[$dir] = @() }
            $grouped[$dir] += $parts[-1]
        }

        foreach ($dir in ($grouped.Keys | Sort-Object)) {
            $fileList = $grouped[$dir]
            $count = $fileList.Count
            # Show files for small directories, just count for large ones
            if ($count -le 5) {
                $names = ($fileList | Sort-Object) -join ", "
                $lines += "  $dir/ ($count): $names"
            } else {
                $lines += "  $dir/ ($count files)"
            }
        }

        # Add key files summary
        $lines += ""
        $lines += "KEY FILES:"
        $lines += "  src/lib/supabase/types.ts - All DB table types (Row/Insert/Update)"
        $lines += "  src/lib/supabase/server.ts - Server-side Supabase client"
        $lines += "  src/lib/supabase/client.ts - Client-side Supabase client"

        return ($lines -join "`n")
    } finally {
        Pop-Location
    }
}

function Get-RecentChangesContext {
    param([int]$MaxCommits = 8)
    Push-Location $PROJECT_ROOT
    try {
        $logs = git log --oneline -$MaxCommits 2>&1
        if (-not $logs) { return "" }

        $lines = @()
        $lines += "RECENT COMMITS (what previous loops built -- DO NOT REPEAT these):"
        foreach ($l in ($logs -split "`n")) {
            if ($l.Trim()) { $lines += "  $l" }
        }

        # Also show what files were changed recently
        $recentFiles = git diff --name-only "HEAD~$MaxCommits" HEAD 2>&1
        if ($recentFiles) {
            $lines += ""
            $lines += "FILES ALREADY MODIFIED RECENTLY:"
            foreach ($f in ($recentFiles -split "`n")) {
                if ($f.Trim()) { $lines += "  $f" }
            }
        }

        return ($lines -join "`n")
    } finally {
        Pop-Location
    }
}

#region LEARNABLE: Get-CommonErrorPatterns
function Get-CommonErrorPatterns {
    $lines = @(
        "COMMON ERROR PATTERNS IN THIS CODEBASE:",
        "  * Supabase never type: The Database types may not include Relationships. Fix with type assertion: .single() as unknown as { field: type } or cast the result.",
        "  * Import paths use @/ alias: import { X } from @/lib/...",
        "  * Components need use client directive at top of new client components.",
        "  * Supabase client: server-side uses createClient() from @/lib/supabase/server, client-side uses createBrowserClient() from @/lib/supabase/client.",
        "  * eslint: unused vars get flagged. Remove them or prefix with _.",
        "  * ReactMarkdown, framer-motion, lucide-react are available (no new installs needed)."
    )
    return ($lines -join "`n")
}
#endregion LEARNABLE: Get-CommonErrorPatterns

function Get-CurrentHead {
    Push-Location $PROJECT_ROOT
    try {
        $hash = git rev-parse HEAD 2>&1
        return "$hash".Trim()
    } finally {
        Pop-Location
    }
}

function Get-CommitsSince {
    param([string]$SinceHash)
    Push-Location $PROJECT_ROOT
    try {
        $logs = @(git log --oneline "${SinceHash}..HEAD" 2>&1)
        return @($logs | Where-Object { $_ -and "$_".Trim() -ne "" } | ForEach-Object { "$_".Trim() })
    } finally {
        Pop-Location
    }
}

function Get-FilesSince {
    param([string]$SinceHash)
    Push-Location $PROJECT_ROOT
    try {
        $files = @(git diff --name-only "${SinceHash}..HEAD" 2>&1)
        return @($files | Where-Object { $_ -and "$_".Trim() -ne "" } | ForEach-Object { "$_".Trim() })
    } finally {
        Pop-Location
    }
}

function Write-LoopCompletion {
    param(
        [int]$Loop,
        [array]$Commits,
        [array]$Files,
        [string]$Observation,
        [int]$ElapsedSeconds
    )

    $elapsed = if ($ElapsedSeconds -ge 60) {
        "$([math]::Floor($ElapsedSeconds / 60))m $($ElapsedSeconds % 60)s"
    } else {
        "${ElapsedSeconds}s"
    }

    Write-Host ""
    Write-Host "  ========================================" -ForegroundColor Green
    Write-Host "  LOOP $Loop COMPLETED ($elapsed)" -ForegroundColor Green
    Write-Host "  ========================================" -ForegroundColor Green

    # Show what Claude committed
    if ($Commits.Count -gt 0) {
        Write-Host ""
        Write-Host "  Commits:" -ForegroundColor White
        foreach ($c in $Commits) {
            # Skip the "overnight: Progress" commits - show the feature commits
            if ($c -notmatch "overnight: Progress") {
                Write-Host "    $c" -ForegroundColor Cyan
            }
        }
    }

    # Show files touched
    if ($Files.Count -gt 0) {
        Write-Host ""
        Write-Host "  Files changed ($($Files.Count)):" -ForegroundColor White
        foreach ($f in $Files) {
            Write-Host "    $f" -ForegroundColor DarkGray
        }
    }

    # Show observation if captured
    if ($Observation) {
        Write-Host ""
        Write-Host "  Observation:" -ForegroundColor DarkCyan
        Write-Host "    $Observation" -ForegroundColor DarkCyan
    }

    Write-Host ""
    Write-Host "  ----------------------------------------" -ForegroundColor DarkGray
    Write-Host ""
}

# =============================================================================
# FIXER AI - Specialist that takes over when main AI fails
# =============================================================================

function Invoke-FixerAI {
    param(
        [string]$ErrorMessage,
        [string]$Context = "",
        [int]$MaxRetries = 2
    )

    Write-Phase "FIXER AI" "Specialist taking over"
    Write-Log "  Error to fix: $($ErrorMessage.Substring(0, [Math]::Min(100, $ErrorMessage.Length)))..." "Yellow"

    $errorPatterns = Get-CommonErrorPatterns

    $fixerPrompt = @"
You are the FIXER AI for a Next.js + Supabase + TypeScript project. Fix this specific error.

ERROR TO FIX:
$ErrorMessage

CONTEXT:
$Context

$errorPatterns

INSTRUCTIONS:
1. Read the file mentioned in the error
2. USE THE EDIT TOOL to fix the error (do NOT just describe the fix)
3. Run: git add <file>
4. Run: git commit -m "Fix: [brief description]"

CRITICAL RULES:
- You MUST use the Edit tool. Not Write. Not describe. EDIT.
- Fix ONLY this error. Do not refactor or improve anything else.
- If you cannot fix it, output: BLOCKED: [reason]
- Do NOT output a summary or explanation. Just fix and commit.

GO. Use the Edit tool NOW.
"@

    for ($attempt = 1; $attempt -le $MaxRetries; $attempt++) {
        Write-Log "  Fixer attempt $attempt of $MaxRetries..." "Cyan"

        try {
            $job = Start-Job -ScriptBlock {
                param($p)
                claude --dangerously-skip-permissions --print $p 2>&1
            } -ArgumentList $fixerPrompt

            $fixerStartTime = Get-Date
            $fixerTimeout = 600  # 10 minutes max for fixer
            $timedOut = $false
            while ($job.State -eq 'Running') {
                $elapsed = [math]::Round(((Get-Date) - $fixerStartTime).TotalSeconds)
                if ($elapsed -gt $fixerTimeout) {
                    Write-Log "  Fixer timed out after ${fixerTimeout}s - killing" "Yellow"
                    Stop-Job -Job $job
                    $timedOut = $true
                    break
                }
                Write-Spinner "Fixer working... (${elapsed}s)"
                Start-Sleep -Milliseconds 500
            }

            $rawOutput = Receive-Job -Job $job
            Remove-Job -Job $job
            if ($timedOut) {
                Invoke-Revert
                continue
            }
            $fixerOutput = if ($rawOutput -is [array]) { $rawOutput -join "`n" } else { "$rawOutput" }

            $elapsed = [math]::Round(((Get-Date) - $fixerStartTime).TotalSeconds)
            Write-SpinnerDone "Fixer finished (${elapsed}s)" $true

            # Check if fixer made changes
            $changedFiles = @(Get-ChangedFiles)
            if ($changedFiles.Count -gt 0) {
                Write-Log "  Fixer made changes to $($changedFiles.Count) file(s)" "Green"
                return @{ success = $true; output = $fixerOutput; files = $changedFiles }
            }

            # Check if blocked
            if ($fixerOutput -match "BLOCKED:\s*(.+)") {
                Write-Log "  Fixer blocked: $($Matches[1])" "Yellow"
                return @{ success = $false; output = $fixerOutput; reason = "blocked" }
            }

            Write-Log "  Fixer made no changes, retrying..." "Yellow"

        } catch {
            Write-Log "  Fixer error: $_" "Red"
        }
    }

    Write-SpinnerDone "Fixer could not fix the issue" $false
    return @{ success = $false; output = ""; reason = "no_changes" }
}

# =============================================================================
# FIX SUB-LOOPS - Fast targeted error fixing
# =============================================================================

function Invoke-FixLoop {
    param(
        [int]$MainLoop,
        [string]$ErrorMessage,
        $Config,
        [int]$MaxSubLoops = 10,
        [string]$AttemptedChange = ""
    )

    Write-Phase "FIX MODE" "Entering sub-loop to fix error"

    $techStack = $Config.project.techStack
    $errorPatterns = Get-CommonErrorPatterns

    $attemptSection = ""
    if ($AttemptedChange) {
        $attemptSection = @"

WHAT WAS BEING ATTEMPTED:
$AttemptedChange
"@
    }

    # Rich prompt with context
    $fixPrompt = @"
You are fixing a $techStack project. Fix this error and nothing else.

ERROR:
$ErrorMessage
$attemptSection

$errorPatterns

INSTRUCTIONS:
1. Read the file at the line mentioned in the error
2. USE THE EDIT TOOL to fix the specific error
3. git add <file>
4. git commit -m "Fix: [brief description]"

RULES:
- Use Edit tool. Not Write. Not describe. EDIT.
- Fix ONLY this error. No refactoring, no improvements.
- Import paths use @/ alias (e.g. @/lib/supabase/types)
- If truly impossible: BLOCKED: [reason]

GO.
"@

    $consecutiveNoChanges = 0
    $maxConsecutiveNoChanges = 3

    for ($subLoop = 1; $subLoop -le $MaxSubLoops; $subLoop++) {
        $loopLabel = "$MainLoop.$subLoop"
        Write-Host ""
        Write-Host "  [SUB-LOOP $loopLabel] Fixing error..." -ForegroundColor Yellow

        $subStartTime = Get-Date

        try {
            $job = Start-Job -ScriptBlock {
                param($p)
                claude --dangerously-skip-permissions --print $p 2>&1
            } -ArgumentList $fixPrompt

            $subTimeout = 600  # 10 minutes max for sub-loop
            $timedOut = $false
            while ($job.State -eq 'Running') {
                $elapsed = [math]::Round(((Get-Date) - $subStartTime).TotalSeconds)
                if ($elapsed -gt $subTimeout) {
                    Write-Log "  Sub-loop $loopLabel timed out after ${subTimeout}s - killing" "Yellow"
                    Stop-Job -Job $job
                    $timedOut = $true
                    break
                }
                Write-Spinner "Sub-loop $loopLabel working... (${elapsed}s)"
                Start-Sleep -Milliseconds 500
            }

            $rawOutput = Receive-Job -Job $job
            Remove-Job -Job $job
            if ($timedOut) {
                Invoke-Revert
                continue
            }
            $fixOutput = if ($rawOutput -is [array]) { $rawOutput -join "`n" } else { "$rawOutput" }

            $elapsed = [math]::Round(((Get-Date) - $subStartTime).TotalSeconds)
            Write-SpinnerDone "Sub-loop $loopLabel finished (${elapsed}s)" $true

            # Check if blocked
            if ($fixOutput -match "BLOCKED:\s*(.+)") {
                Write-Log "    BLOCKED: $($Matches[1])" "Yellow"
                continue
            }

            # Check for changes
            $changedFiles = @(Get-ChangedFiles)
            if ($null -eq $changedFiles -or $changedFiles.Count -eq 0) {
                $consecutiveNoChanges++
                if ($consecutiveNoChanges -ge $maxConsecutiveNoChanges) {
                    Write-Log "    $maxConsecutiveNoChanges consecutive no-change attempts - giving up" "Yellow"
                    break
                }
                Write-Log "    No changes made ($consecutiveNoChanges/$maxConsecutiveNoChanges), retrying..." "Yellow"
                # Update prompt with feedback + error patterns
                $fixPrompt = @"
You are fixing a $techStack project. Your last attempt MADE NO CHANGES.

ERROR TO FIX:
$ErrorMessage

$errorPatterns

YOU MUST:
1. Read the file mentioned in the error (use the Read tool)
2. USE THE EDIT TOOL on the specific line that is broken
3. git add <file>
4. git commit -m "Fix: [brief description]"

Do NOT describe. Do NOT explain. Read the file, then EDIT it. GO.
"@
                continue
            }

            $consecutiveNoChanges = 0  # Reset on success
            Write-Log "    Changes detected in $($changedFiles.Count) file(s)" "Green"

            # Run quality gates
            $gateResult = Invoke-QualityGates $Config
            if ($gateResult.passed) {
                Write-SpinnerDone "Sub-loop $loopLabel FIXED IT!" $true
                return @{
                    success = $true
                    subLoopsUsed = $subLoop
                    files = $changedFiles
                }
            } else {
                Write-Log "    Still failing, updating error..." "Yellow"
                Invoke-Revert
                # Update prompt with new error + context
                $fixPrompt = @"
You are fixing a $techStack project. Your previous fix attempt introduced a NEW error.

NEW ERROR:
$($gateResult.error)

$errorPatterns

Try a DIFFERENT approach this time.

1. Read the file mentioned in the error
2. USE THE EDIT TOOL to fix it
3. git add <file>
4. git commit -m "Fix: [brief description]"

GO.
"@
            }

        } catch {
            Write-Log "    Sub-loop error: $_" "Red"
        }
    }

    Write-SpinnerDone "Fix loop exhausted after $MaxSubLoops attempts" $false
    Invoke-Revert
    return @{
        success = $false
        subLoopsUsed = $MaxSubLoops
        reason = "exhausted"
    }
}

# =============================================================================
# BOLDNESS LEVELS
# =============================================================================

#region LEARNABLE: Get-CurrentBoldness
function Get-CurrentBoldness {
    param(
        [string]$Boldness,
        [int]$CurrentLoop,
        [int]$MaxLoops
    )

    if ($Boldness -ne "adaptive") {
        return $Boldness
    }

    # Adaptive: start high, decrease over time
    $progress = $CurrentLoop / $MaxLoops

    if ($progress -lt 0.33) {
        return "high"      # First third: go big
    } elseif ($progress -lt 0.66) {
        return "medium"    # Middle third: balanced
    } else {
        return "low"       # Final third: polish and complete
    }
}
#endregion LEARNABLE: Get-CurrentBoldness

#region LEARNABLE: Get-BoldnessLimits
function Get-BoldnessLimits {
    param([string]$Level, [int]$ConfigMaxFiles)

    switch ($Level) {
        "high" {
            return @{
                exploreFiles = "10-15"
                maxChangeFiles = [Math]::Min($ConfigMaxFiles, 15)
                scanDepth = "deep"
            }
        }
        "medium" {
            return @{
                exploreFiles = "6-10"
                maxChangeFiles = [Math]::Min($ConfigMaxFiles, 10)
                scanDepth = "moderate"
            }
        }
        "low" {
            return @{
                exploreFiles = "3-5"
                maxChangeFiles = [Math]::Min($ConfigMaxFiles, 5)
                scanDepth = "focused"
            }
        }
    }
}
#endregion LEARNABLE: Get-BoldnessLimits

#region LEARNABLE: Get-BoldnessPrompt
function Get-BoldnessPrompt {
    param([string]$Level, [int]$CurrentLoop, [int]$MaxLoops)

    $progress = [math]::Round(($CurrentLoop / $MaxLoops) * 100)

    switch ($Level) {
        "high" {
            return @"
BOLDNESS: MAXIMUM (Loop $CurrentLoop of $MaxLoops - $progress% through)
- GO BIG. This is the time for ambitious, structural changes.
- Break things if needed - there's runway to fix them.
- Start multi-loop arcs. Don't worry about finishing everything.
- If it feels scary or "too big" - THAT'S THE RIGHT CHANGE TO MAKE.
- Partial implementations are FINE. Leave TODOs. Future loops will continue.
- You're building the foundation. Be bold.
"@
        }
        "medium" {
            return @"
BOLDNESS: BALANCED (Loop $CurrentLoop of $MaxLoops - $progress% through)
- Build on what previous loops started. Check observations for context.
- Still be ambitious, but start completing partial work.
- New features are OK, but also wire up and polish existing ones.
- Balance between new functionality and making things work well together.
- If something is half-done from earlier loops, consider finishing it.
"@
        }
        "low" {
            return @"
BOLDNESS: CONSERVATIVE (Loop $CurrentLoop of $MaxLoops - $progress% through)
- Focus on COMPLETING and POLISHING. Less time remaining.
- Fix bugs, wire up loose ends, complete partial implementations.
- Avoid starting new big features - finish what's already started.
- Make sure everything works together smoothly.
- Quality over quantity. Ship something solid.
"@
        }
    }
}
#endregion LEARNABLE: Get-BoldnessPrompt

# =============================================================================
# PROMPTS
# =============================================================================

#region LEARNABLE: Get-TaskPrompt
function Get-TaskPrompt {
    param($task, $config)
    $projectName = $config.project.name
    $techStack = $config.project.techStack
    $maxFiles = $config.safety.maxFilesPerTask

    return @"
You are improving $projectName ($techStack).

CURRENT TASK:
$($task.description)

STRICT RULES:
- Maximum $maxFiles files changed
- NO package.json changes (no new dependencies)
- NO database schema changes
- NO .env or secret files

WORKFLOW:
1. Understand what files you need to modify
2. List files BEFORE editing (max $maxFiles)
3. Implement the change
4. Stage files: git add <specific-files>
5. Commit with a clear message

If task requires more than $maxFiles files: output "SKIP: [reason]"
If blocked: output "NOOP: [explanation]"

Focus on quality. Make it work correctly.
"@
}
#endregion LEARNABLE: Get-TaskPrompt

#region LEARNABLE: Get-GoalPrompt
function Get-GoalPrompt {
    param([string]$goal, [string]$vision, $state, $config, [string]$boldness, [int]$maxLoops, [string]$manifest = "", [string]$recentChanges = "")

    $projectName = $config.project.name
    $projectDesc = $config.project.description
    $techStack = $config.project.techStack
    $maxFiles = $config.safety.maxFilesPerTask
    $loopNum = $state.currentLoop

    $observations = $state.observations | Select-Object -Last 5
    $observationText = if ($observations) { $observations -join "`n" } else { "None yet" }

    # Calculate boldness for this loop
    $currentBoldness = Get-CurrentBoldness -Boldness $boldness -CurrentLoop $loopNum -MaxLoops $maxLoops
    $boldnessPrompt = Get-BoldnessPrompt -Level $currentBoldness -CurrentLoop $loopNum -MaxLoops $maxLoops
    $boldnessLimits = Get-BoldnessLimits -Level $currentBoldness -ConfigMaxFiles $maxFiles
    $exploreFiles = $boldnessLimits.exploreFiles
    $effectiveMaxFiles = $boldnessLimits.maxChangeFiles

    $visionSection = if ($vision) {
        @"

PRODUCT VISION:
$vision
"@
    } else { "" }

    # Include last output if Claude didn't make changes last time
    $lastOutputSection = ""
    if ($state.lastOutput -and $state.lastOutput.Trim()) {
        $lastOutputSection = @"

LAST LOOP (No changes made):
$($state.lastOutput)
---
NOW ACT. Don't analyze again.
"@
    }

    # Include last failure if quality gates failed
    $lastFailureSection = ""
    if ($state.lastFailure -and $state.lastFailure.Trim()) {
        $lastFailureSection = @"

LAST LOOP FAILED - FIX THIS:
$($state.lastFailure)
---
Make the same improvement but fix the error above.
"@
    }

    return @"
You are the overnight AI improving $projectName - $projectDesc ($techStack).
$visionSection

GOAL: $goal
$lastOutputSection$lastFailureSection

LOOP $loopNum - SHIP SOMETHING MEANINGFUL.

$boldnessPrompt

MINDSET:
- Think like a cofounder shipping v1, not an intern fixing typos.
- You can change up to $effectiveMaxFiles files this loop.
- Previous loops already did work (see below). BUILD ON IT, don't repeat it.

$manifest

$recentChanges

WHAT TO DO:
- You already have the file structure above -- SKIP running find/ls commands.
- Read $exploreFiles specific files you want to change (use the manifest to pick them).
- Find a GAP - something missing that users would love.
- Build it.

HIGH-IMPACT IDEAS (focus on genuine value, NOT gamification):
- Make the AI feel like ONE mind that remembers everything about the user
- AI that connects dots ("Last week you said X, now you're feeling Y...")
- Moments that make users think "holy shit, it actually gets me"
- Reduce anxiety - users should feel calmer and clearer after using the app
- Smart defaults that reduce friction
- Personalization that makes it feel like YOUR cofounder
- NO streaks, XP, badges, or guilt-based retention. Make it genuinely good instead.

OBSERVATIONS FROM PREVIOUS LOOPS:
$observationText

RULES:
- Max $effectiveMaxFiles files per commit (based on current boldness)
- No package.json, schema, or .env changes

DO THIS:
1. Quick explore
2. Pick ONE improvement
3. USE THE EDIT TOOL to modify files (do NOT just describe changes)
4. git add <files>
5. git commit -m "Improve: [what]"

CRITICAL - READ THIS:
- You MUST use the Edit or Write tool to change files
- DO NOT just describe what you would change
- DO NOT output a plan or summary without actually editing
- If you catch yourself writing "I would change..." STOP and USE THE EDIT TOOL instead
- The ONLY acceptable output is: explore, edit files, commit
- Describing changes without making them = FAILURE

If you spot other opportunities: OBSERVATION: [note for later]
If truly blocked: BLOCKED: [why]

NOW USE THE EDIT TOOL AND SHIP IT.
"@
}
#endregion LEARNABLE: Get-GoalPrompt

# =============================================================================
# REPORT
# =============================================================================

function New-MorningReport {
    param($state, $taskData, $config)

    $projectName = $config.project.name
    $mainBranch = $config.git.mainBranch
    $endTime = Get-Date
    $startTime = if ($state.startedAt) { try { [DateTime]::Parse($state.startedAt) } catch { $endTime } } else { $endTime }
    $duration = $endTime - $startTime

    $completedList = ($state.completedTasks | ForEach-Object { "- [x] Task $_" }) -join "`n"
    if (-not $completedList) { $completedList = "None" }

    $failedList = ($state.failedTasks | ForEach-Object { "- [ ] Task $_" }) -join "`n"
    if (-not $failedList) { $failedList = "None" }

    $observationList = ($state.observations | ForEach-Object { "- $_" }) -join "`n"
    if (-not $observationList) { $observationList = "None recorded" }

    $completionList = ""
    if ($state.loopCompletions -and $state.loopCompletions.Count -gt 0) {
        $completionList = ($state.loopCompletions | ForEach-Object { "- $_" }) -join "`n"
    } else {
        $completionList = "None recorded"
    }

    $report = @"
# Overnight Report - $projectName - $(Get-Date -Format "yyyy-MM-dd")

## Summary
- **Started:** $($startTime.ToString("h:mm tt"))
- **Ended:** $($endTime.ToString("h:mm tt"))
- **Duration:** $([math]::Round($duration.TotalHours, 1)) hours
- **Loops:** $($state.currentLoop)
- **Commits:** $($state.totalCommits)

## What Was Built
$completionList

## Task Status
$completedList

## Failed
$failedList

## AI Observations
$observationList

## Next Steps
1. Review: ``git log --oneline $mainBranch..HEAD``
2. Diff: ``git diff $mainBranch..HEAD``
3. Merge or cherry-pick

---
*Generated by Overnight AI Experiment v3 - Self-Improving*
"@

    if (-not (Test-Path $REPORT_DIR)) { New-Item -ItemType Directory -Path $REPORT_DIR -Force | Out-Null }
    $report | Set-Content $REPORT_FILE
    Write-Log "Report saved: $REPORT_FILE" "Green"
    return $report
}

# =============================================================================
# SELF-IMPROVEMENT (hardcoded -- these functions cannot modify themselves)
# =============================================================================

function Get-RunAnalysis {
    param($State)

    $totalLoops = if ($State.currentLoop) { $State.currentLoop } else { 0 }
    if ($totalLoops -le 0) { $totalLoops = 1 }

    $completedCount = if ($State.completedTasks -and @($State.completedTasks).Count -gt 0) { @($State.completedTasks).Count } else { 0 }
    $successRate = [math]::Round($completedCount / $totalLoops, 2)

    # Parse log file for metrics
    $subLoopWaste = 0
    $gateFailures = @{ typecheck = 0; lint = 0; build = 0 }
    $newErrors = @()
    $loopTimestamps = @()

    if (Test-Path $LOG_FILE) {
        $logLines = Get-Content $LOG_FILE -ErrorAction SilentlyContinue
        foreach ($line in $logLines) {
            # Count sub-loop waste
            if ($line -match "Sub-loop|No changes made") {
                $subLoopWaste++
            }
            # Count gate failures by type
            if ($line -match "TypeScript.*FAILED") { $gateFailures.typecheck++ }
            if ($line -match "Lint.*FAILED") { $gateFailures.lint++ }
            if ($line -match "Build.*FAILED") { $gateFailures.build++ }
            # Collect timestamps for average loop duration
            if ($line -match "^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] LOOP \d+ ") {
                $loopTimestamps += $Matches[1]
            }
            # Look for error patterns not in our known list
            if ($line -match "error TS\d+:.*?:\s*(.+)") {
                $errorMsg = $Matches[1].Trim()
                # Normalize: take first 80 chars
                if ($errorMsg.Length -gt 80) { $errorMsg = $errorMsg.Substring(0, 80) }
                if ($newErrors -notcontains $errorMsg) {
                    $newErrors += $errorMsg
                }
            }
        }
    }

    # Calculate average loop duration from timestamps
    $avgLoopSeconds = 0
    if ($loopTimestamps.Count -ge 2) {
        $durations = @()
        for ($t = 1; $t -lt $loopTimestamps.Count; $t++) {
            try {
                $prev = [DateTime]::Parse($loopTimestamps[$t - 1])
                $curr = [DateTime]::Parse($loopTimestamps[$t])
                $durations += ($curr - $prev).TotalSeconds
            } catch { }
        }
        if ($durations.Count -gt 0) {
            $avgLoopSeconds = [math]::Round(($durations | Measure-Object -Average).Average)
        }
    }

    # Filter new errors: remove ones already in Get-CommonErrorPatterns
    $knownPatterns = Get-CommonErrorPatterns
    $unknownErrors = @()
    foreach ($err in $newErrors) {
        $isKnown = $false
        if ($knownPatterns -match [regex]::Escape($err.Substring(0, [Math]::Min(30, $err.Length)))) {
            $isKnown = $true
        }
        if (-not $isKnown) { $unknownErrors += $err }
    }

    $noOps = if ($null -ne $State.consecutiveNoOps) { $State.consecutiveNoOps } else { 0 }
    $noOpRate = [math]::Round($noOps / $totalLoops, 2)

    # Extract completed features from loop completions
    $completedFeatures = @()
    if ($State.loopCompletions) {
        foreach ($entry in $State.loopCompletions) {
            if ($entry -match "Loop \d+: \w+ (.+?) \(") {
                $completedFeatures += $Matches[1]
            }
        }
    }

    return @{
        date = (Get-Date -Format "yyyy-MM-dd")
        branch = (git rev-parse --abbrev-ref HEAD 2>&1).Trim()
        loops = $totalLoops
        commits = $State.totalCommits
        successRate = $successRate
        subLoopWaste = $subLoopWaste
        avgLoopSeconds = $avgLoopSeconds
        gateFailures = $gateFailures
        errorPatterns = $newErrors
        newErrorsEncountered = $unknownErrors
        completedFeatures = $completedFeatures
        noOpRate = $noOpRate
        observations = if ($State.observations) { @($State.observations | Select-Object -Last 5) } else { @() }
    }
}

function Save-RunHistory {
    param($Analysis)

    $history = @{
        runs = @()
        scriptVersion = 3
        lastImprovement = ""
        improvementCount = 0
    }

    if (Test-Path $RUN_HISTORY_FILE) {
        try {
            $history = Get-Content $RUN_HISTORY_FILE -Raw | ConvertFrom-Json | ConvertTo-Hashtable
            # Ensure arrays
            if ($null -eq $history.runs) { $history.runs = @() }
        } catch {
            Write-Log "Could not parse run-history.json, starting fresh" "Yellow"
        }
    }

    $history.runs += $Analysis
    $history.scriptVersion = 3
    $history | ConvertTo-Json -Depth 10 | Set-Content $RUN_HISTORY_FILE
    Write-Log "Run history saved ($($history.runs.Count) total runs)" "Green"
}

function Should-Improve {
    param($Analysis)

    # Load history
    if (-not (Test-Path $RUN_HISTORY_FILE)) { return $false }
    $history = Get-Content $RUN_HISTORY_FILE -Raw | ConvertFrom-Json | ConvertTo-Hashtable
    if ($null -eq $history.runs) { return $false }

    $runCount = @($history.runs).Count

    # Not enough data
    if ($runCount -lt 2) {
        Write-Log "  Skip improvement: only $runCount run(s) in history (need 2+)" "DarkGray"
        return $false
    }

    # Avoid churn: don't improve if last improvement was less than 1 run ago
    if ($history.lastImprovement) {
        $runsSinceImprovement = 0
        for ($r = $runCount - 1; $r -ge 0; $r--) {
            if ($history.runs[$r].date -le $history.lastImprovement) { break }
            $runsSinceImprovement++
        }
        if ($runsSinceImprovement -lt 1) {
            Write-Log "  Skip improvement: last improvement was too recent" "DarkGray"
            return $false
        }
    }

    # If it's working great, don't touch it
    if ($Analysis.successRate -gt 0.95 -and @($Analysis.newErrorsEncountered).Count -eq 0) {
        Write-Log "  Skip improvement: success rate $($Analysis.successRate) with no new errors" "DarkGray"
        return $false
    }

    # Check improvement triggers
    $totalLoopTime = if ($Analysis.loops -gt 0) { $Analysis.loops } else { 1 }

    # Sub-loop waste > 20%
    if ($Analysis.subLoopWaste -gt ($totalLoopTime * 0.2)) {
        Write-Log "  Improvement trigger: sub-loop waste $($Analysis.subLoopWaste) > 20% of loops" "Cyan"
        return $true
    }

    # Success rate dropped vs previous run
    if ($runCount -ge 2) {
        $prevRun = $history.runs[$runCount - 2]
        $prevRate = if ($prevRun.successRate) { $prevRun.successRate } else { 0 }
        if ($Analysis.successRate -lt $prevRate) {
            Write-Log "  Improvement trigger: success rate dropped $prevRate -> $($Analysis.successRate)" "Cyan"
            return $true
        }
    }

    # New error patterns encountered
    if (@($Analysis.newErrorsEncountered).Count -gt 0) {
        Write-Log "  Improvement trigger: $(@($Analysis.newErrorsEncountered).Count) new error pattern(s)" "Cyan"
        return $true
    }

    # No-op rate > 15%
    if ($Analysis.noOpRate -gt 0.15) {
        Write-Log "  Improvement trigger: no-op rate $($Analysis.noOpRate) > 15%" "Cyan"
        return $true
    }

    # 3+ runs since last improvement
    $runsSinceLast = $runCount
    if ($history.lastImprovement) {
        $runsSinceLast = 0
        for ($r = $runCount - 1; $r -ge 0; $r--) {
            if ($history.runs[$r].date -le $history.lastImprovement) { break }
            $runsSinceLast++
        }
    }
    if ($runsSinceLast -ge 3) {
        Write-Log "  Improvement trigger: $runsSinceLast runs since last improvement" "Cyan"
        return $true
    }

    Write-Log "  No improvement triggers met" "DarkGray"
    return $false
}

function Get-ImprovableFunctions {
    $scriptPath = $MyInvocation.ScriptName
    if (-not $scriptPath) { $scriptPath = "$SCRIPT_DIR\overnight-v3.ps1" }

    $scriptContent = Get-Content $scriptPath -Raw
    $functions = @{}

    # Extract all LEARNABLE regions
    $pattern = '(?s)#region LEARNABLE: (\S+)\r?\n(.+?)#endregion LEARNABLE: \1'
    $matches = [regex]::Matches($scriptContent, $pattern)

    foreach ($m in $matches) {
        $name = $m.Groups[1].Value
        $body = $m.Groups[2].Value.Trim()
        $functions[$name] = $body
        Write-Log "  Extracted learnable function: $name ($($body.Split("`n").Count) lines)" "DarkGray"
    }

    if ($functions.Count -eq 0) {
        Write-Log "  WARNING: No learnable functions found!" "Yellow"
    }

    return $functions
}

function Get-SelfImprovementPrompt {
    param($Analysis, $Functions)

    # Build analysis section
    $analysisText = @"
RUN ANALYSIS (most recent):
- Date: $($Analysis.date)
- Branch: $($Analysis.branch)
- Loops: $($Analysis.loops)
- Commits: $($Analysis.commits)
- Success rate: $($Analysis.successRate)
- Sub-loop waste: $($Analysis.subLoopWaste)
- Avg loop duration: $($Analysis.avgLoopSeconds)s
- No-op rate: $($Analysis.noOpRate)
- Gate failures: typecheck=$($Analysis.gateFailures.typecheck) lint=$($Analysis.gateFailures.lint) build=$($Analysis.gateFailures.build)
- New errors encountered: $(if (@($Analysis.newErrorsEncountered).Count -gt 0) { ($Analysis.newErrorsEncountered -join '; ') } else { 'none' })
- Error patterns: $(if (@($Analysis.errorPatterns).Count -gt 0) { ($Analysis.errorPatterns -join '; ') } else { 'none' })
"@

    # Build historical trend from run-history.json
    $historyText = "HISTORICAL TREND: Not enough data yet."
    if (Test-Path $RUN_HISTORY_FILE) {
        try {
            $history = Get-Content $RUN_HISTORY_FILE -Raw | ConvertFrom-Json | ConvertTo-Hashtable
            if ($history.runs -and @($history.runs).Count -ge 2) {
                $recentRuns = @($history.runs) | Select-Object -Last 5
                $trendLines = @("HISTORICAL TREND (last $(@($recentRuns).Count) runs):")
                foreach ($run in $recentRuns) {
                    $rate = if ($run.successRate) { $run.successRate } else { "?" }
                    $loops = if ($run.loops) { $run.loops } else { "?" }
                    $commits = if ($run.commits) { $run.commits } else { "?" }
                    $trendLines += "  - $($run.date): $loops loops, $commits commits, success=$rate"
                }
                $historyText = $trendLines -join "`n"
            }
        } catch { }
    }

    # Build functions section
    $functionLines = @("FUNCTIONS YOU CAN IMPROVE:")
    foreach ($name in $Functions.Keys) {
        $code = $Functions[$name]
        $lineCount = $code.Split("`n").Count
        $functionLines += ""
        $functionLines += "### FUNCTION: $name ($lineCount lines)"
        $functionLines += '```powershell'
        $functionLines += $code
        $functionLines += '```'
    }
    $functionsText = $functionLines -join "`n"

    return @"
You are improving a PowerShell overnight experiment script based on real performance data.

$analysisText

$historyText

$functionsText

RULES:
- Return ONLY the improved function bodies as PowerShell code blocks
- Each block must start with: ### FUNCTION: <name>
- Do NOT change function signatures (parameters, return types)
- Do NOT add new functions -- only improve existing ones
- Focus on the specific problems shown in the analysis
- If Get-CommonErrorPatterns is missing patterns that caused failures, ADD them
- If prompts are causing too many no-ops, make them MORE ACTIONABLE
- If boldness thresholds are wrong, adjust them
- Keep all code valid PowerShell
- Do NOT use unicode characters (em-dashes, smart quotes, etc.)
- If nothing needs improving, respond with exactly: NO_IMPROVEMENT_NEEDED
"@
}

function Test-ImprovedScript {
    param([string]$ImprovedScriptContent)

    $results = @{ passed = $true; stage = ""; error = "" }

    # Stage 1: Syntax check
    Write-Log "  Stage 1/4: Syntax check..." "DarkGray"
    $tempFile = "$SCRIPT_DIR\overnight-v3-test.ps1"
    try {
        $ImprovedScriptContent | Set-Content $tempFile -Encoding UTF8
        $syntaxOutput = powershell -NoProfile -Command "& { `$null = [System.Management.Automation.PSParser]::Tokenize((Get-Content '$tempFile' -Raw), [ref]`$null); Write-Output 'SYNTAX_OK' }" 2>&1
        $syntaxStr = if ($syntaxOutput -is [array]) { $syntaxOutput -join "`n" } else { "$syntaxOutput" }
        if ($syntaxStr -notmatch "SYNTAX_OK") {
            $results.passed = $false
            $results.stage = "syntax"
            $results.error = "Syntax error: $syntaxStr"
            return $results
        }
        Write-Log "    Syntax check passed" "Green"
    } finally {
        if (Test-Path $tempFile) { Remove-Item $tempFile -Force -ErrorAction SilentlyContinue }
    }

    # Stage 2: Diff guard -- no single function should change by more than 50 lines
    Write-Log "  Stage 2/4: Diff guard..." "DarkGray"
    $scriptPath = if ($MyInvocation.ScriptName) { $MyInvocation.ScriptName } else { "$SCRIPT_DIR\overnight-v3.ps1" }
    $originalContent = Get-Content $scriptPath -Raw
    $originalFunctions = @{}
    $improvedFunctions = @{}

    $regionPattern = '(?s)#region LEARNABLE: (\S+)\r?\n(.+?)#endregion LEARNABLE: \1'
    $origMatches = [regex]::Matches($originalContent, $regionPattern)
    foreach ($m in $origMatches) { $originalFunctions[$m.Groups[1].Value] = $m.Groups[2].Value }
    $newMatches = [regex]::Matches($ImprovedScriptContent, $regionPattern)
    foreach ($m in $newMatches) { $improvedFunctions[$m.Groups[1].Value] = $m.Groups[2].Value }

    foreach ($name in $originalFunctions.Keys) {
        if ($improvedFunctions.ContainsKey($name)) {
            $origLines = $originalFunctions[$name].Split("`n").Count
            $newLines = $improvedFunctions[$name].Split("`n").Count
            $diff = [Math]::Abs($newLines - $origLines)
            if ($diff -gt 50) {
                $results.passed = $false
                $results.stage = "diff_guard"
                $results.error = "Function $name changed by $diff lines (max 50). Original: $origLines, New: $newLines"
                return $results
            }
        }
    }
    Write-Log "    Diff guard passed" "Green"

    # Stage 3: Structural integrity -- hardcoded functions must still exist unchanged
    Write-Log "  Stage 3/4: Structural integrity..." "DarkGray"
    $hardcodedFunctions = @(
        "Start-OvernightExperiment", "Get-ChangedFiles", "Invoke-SmartStaging",
        "Invoke-Revert", "Invoke-Commit", "Invoke-QualityGate", "Invoke-QualityGates",
        "Initialize-State", "Load-State", "Save-State", "Test-FileAllowed",
        "Invoke-FixLoop", "Invoke-FixerAI", "Load-ProjectConfig", "New-MorningReport",
        "Invoke-SelfImprovement", "Get-RunAnalysis", "Save-RunHistory",
        "Should-Improve", "Get-ImprovableFunctions", "Get-SelfImprovementPrompt",
        "Test-ImprovedScript", "Apply-Improvement"
    )

    foreach ($fn in $hardcodedFunctions) {
        if ($ImprovedScriptContent -notmatch "function $fn\b") {
            $results.passed = $false
            $results.stage = "structural"
            $results.error = "Hardcoded function '$fn' is missing from improved script"
            return $results
        }
    }

    # Verify hardcoded function bodies are unchanged
    foreach ($fn in $hardcodedFunctions) {
        # Extract function body from original (simple: from "function Name" to next "^function " or end)
        $origFnPattern = "(?s)(function ${fn}\s*\{.+?^\})"
        if ($originalContent -match $origFnPattern) {
            $origBody = $Matches[1]
            if ($ImprovedScriptContent -notmatch [regex]::Escape($origBody.Substring(0, [Math]::Min(200, $origBody.Length)))) {
                # Do a lighter check: just verify the function signature line exists
                $sigLine = "function $fn"
                if ($ImprovedScriptContent -notmatch [regex]::Escape($sigLine)) {
                    $results.passed = $false
                    $results.stage = "structural"
                    $results.error = "Hardcoded function '$fn' appears to have been modified"
                    return $results
                }
            }
        }
    }
    Write-Log "    Structural integrity passed" "Green"

    # Stage 4: Dry-run test
    Write-Log "  Stage 4/4: Dry-run test..." "DarkGray"
    $tempFile = "$SCRIPT_DIR\overnight-v3-test.ps1"
    try {
        $ImprovedScriptContent | Set-Content $tempFile -Encoding UTF8
        $dryOutput = powershell -NoProfile -Command "& { . '$tempFile' -DryRun -MaxLoops 1 }" 2>&1
        $dryStr = if ($dryOutput -is [array]) { $dryOutput -join "`n" } else { "$dryOutput" }
        # Check for fatal errors (non-zero exit or exception keywords)
        if ($LASTEXITCODE -ne 0 -and $dryStr -match "error|exception|cannot|failed") {
            $results.passed = $false
            $results.stage = "dry_run"
            $results.error = "Dry-run failed: $($dryStr.Substring(0, [Math]::Min(500, $dryStr.Length)))"
            return $results
        }
        Write-Log "    Dry-run passed" "Green"
    } catch {
        $results.passed = $false
        $results.stage = "dry_run"
        $results.error = "Dry-run exception: $_"
        return $results
    } finally {
        if (Test-Path $tempFile) { Remove-Item $tempFile -Force -ErrorAction SilentlyContinue }
    }

    return $results
}

function Apply-Improvement {
    param([string]$ClaudeResponse)

    $result = @{ applied = $false; changes = @(); reason = "" }

    # Check for no-improvement response
    if ($ClaudeResponse -match "NO_IMPROVEMENT_NEEDED") {
        $result.reason = "Claude determined no improvement needed"
        return $result
    }

    # Parse Claude's response for function blocks
    $functionPattern = '### FUNCTION: (\S+)\s*```powershell\s*([\s\S]*?)```'
    $functionMatches = [regex]::Matches($ClaudeResponse, $functionPattern)

    if ($functionMatches.Count -eq 0) {
        $result.reason = "No valid function blocks found in Claude response"
        Write-Log "  Could not parse improvement response" "Yellow"
        return $result
    }

    # Read current script
    $scriptPath = if ($MyInvocation.ScriptName) { $MyInvocation.ScriptName } else { "$SCRIPT_DIR\overnight-v3.ps1" }
    $scriptContent = Get-Content $scriptPath -Raw

    # Replace each function between region markers
    $changedFunctions = @()
    foreach ($m in $functionMatches) {
        $funcName = $m.Groups[1].Value
        $newBody = $m.Groups[2].Value.Trim()

        # Verify this is a learnable function
        $regionStart = "#region LEARNABLE: $funcName"
        $regionEnd = "#endregion LEARNABLE: $funcName"

        if ($scriptContent -notmatch [regex]::Escape($regionStart)) {
            Write-Log "  Skipping $funcName -- not a learnable function" "Yellow"
            continue
        }

        # Replace content between markers
        $replacePattern = "(?s)($([regex]::Escape($regionStart))\r?\n)(.+?)(\r?\n$([regex]::Escape($regionEnd)))"
        if ($scriptContent -match $replacePattern) {
            $scriptContent = $scriptContent -replace $replacePattern, "`${1}$newBody`${3}"
            $changedFunctions += $funcName
            Write-Log "  Replaced function: $funcName" "Cyan"
        } else {
            Write-Log "  Could not find region markers for $funcName" "Yellow"
        }
    }

    if ($changedFunctions.Count -eq 0) {
        $result.reason = "No learnable functions were changed"
        return $result
    }

    # Validate the improved script through 4-stage pipeline
    Write-Log "  Validating improved script..." "Cyan"
    $validation = Test-ImprovedScript $scriptContent

    if (-not $validation.passed) {
        $result.reason = "Validation failed at stage '$($validation.stage)': $($validation.error)"
        Write-Log "  Validation FAILED: $($result.reason)" "Red"
        return $result
    }

    Write-Log "  All 4 validation stages passed!" "Green"

    # Apply: write to disk and commit
    $scriptContent | Set-Content $scriptPath -Encoding UTF8
    Write-Log "  Script updated on disk" "Green"

    Push-Location $PROJECT_ROOT
    try {
        git add $scriptPath 2>&1 | Out-Null
        $changeDesc = $changedFunctions -join ", "
        $commitMsg = "self-improve: updated $changeDesc"
        git commit -m $commitMsg 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Log "  Committed: $commitMsg" "Green"
        } else {
            Write-Log "  Commit failed (changes still on disk)" "Yellow"
        }
    } finally {
        Pop-Location
    }

    # Update run-history with improvement timestamp
    if (Test-Path $RUN_HISTORY_FILE) {
        try {
            $history = Get-Content $RUN_HISTORY_FILE -Raw | ConvertFrom-Json | ConvertTo-Hashtable
            $history.lastImprovement = (Get-Date -Format "yyyy-MM-dd")
            $history.improvementCount = ($history.improvementCount + 1)
            $history | ConvertTo-Json -Depth 10 | Set-Content $RUN_HISTORY_FILE
        } catch { }
    }

    $result.applied = $true
    $result.changes = $changedFunctions
    return $result
}

function Invoke-SelfImprovement {
    Write-Banner "SELF-IMPROVEMENT PHASE"

    $state = Load-State
    $analysis = Get-RunAnalysis $state
    Write-Log "Run analysis: success=$($analysis.successRate), waste=$($analysis.subLoopWaste), noOp=$($analysis.noOpRate)" "Cyan"

    Save-RunHistory $analysis

    if (Should-Improve $analysis) {
        Write-Log "Improvement warranted - extracting learnable functions..." "Cyan"
        $functions = Get-ImprovableFunctions

        if ($functions.Count -eq 0) {
            Write-Log "No learnable functions found - skipping" "Yellow"
            return
        }

        $prompt = Get-SelfImprovementPrompt $analysis $functions
        Write-Log "Calling Claude for improvement suggestions..." "Cyan"

        try {
            $job = Start-Job -ScriptBlock {
                param($p)
                claude --print $p 2>&1
            } -ArgumentList $prompt

            $improvStartTime = Get-Date
            while ($job.State -eq 'Running') {
                $elapsed = [math]::Round(((Get-Date) - $improvStartTime).TotalSeconds)
                Write-Spinner "Self-improvement thinking... (${elapsed}s)"
                Start-Sleep -Milliseconds 500
            }

            $rawOutput = Receive-Job -Job $job
            Remove-Job -Job $job
            $improved = if ($rawOutput -is [array]) { $rawOutput -join "`n" } else { "$rawOutput" }

            $elapsed = [math]::Round(((Get-Date) - $improvStartTime).TotalSeconds)
            Write-SpinnerDone "Claude responded (${elapsed}s)" $true

            $result = Apply-Improvement $improved
            if ($result.applied) {
                Write-Log "Self-improvement applied: $($result.changes -join ', ')" "Green"
            } else {
                Write-Log "Self-improvement rejected: $($result.reason)" "Yellow"
            }
        } catch {
            Write-Log "Self-improvement error: $_" "Red"
        }
    } else {
        Write-Log "No improvement needed (success rate: $($analysis.successRate))" "DarkGray"
    }
}

# =============================================================================
# MAIN
# =============================================================================

function Start-OvernightExperiment {
    # Load config
    $config = Load-ProjectConfig
    $projectName = $config.project.name
    $mainBranch = $config.git.mainBranch
    $branchPrefix = $config.git.branchPrefix
    $pauseSeconds = $config.timing.pauseSeconds
    $maxRetries = $config.timing.maxRetries
    $maxFailures = $config.safety.maxConsecutiveFailures
    $maxNoOps = $config.safety.maxConsecutiveNoOps

    Write-Banner "OVERNIGHT AI EXPERIMENT v3 - Self-Improving"
    Write-Banner $projectName

    Enable-SleepPrevention
    Set-Location $PROJECT_ROOT

    # Ensure directories
    if (-not (Test-Path $LOG_DIR)) { New-Item -ItemType Directory -Path $LOG_DIR -Force | Out-Null }
    if (-not (Test-Path $REPORT_DIR)) { New-Item -ItemType Directory -Path $REPORT_DIR -Force | Out-Null }

    # Load vision if requested
    $vision = ""
    if ($UseVision) {
        $vision = Load-Vision $config
        if ($vision) {
            Write-Log "Loaded product vision" "Green"
        } else {
            Write-Log "No vision file found" "Yellow"
        }
    }

    # No default goal - if no -Goal specified, runs in general improvement mode

    Write-Log "Project: $projectName" "Cyan"
    Write-Log "Max Loops: $MaxLoops" "Cyan"
    if ($Goal) { Write-Log "Goal Mode: $($Goal.Substring(0, [Math]::Min(50, $Goal.Length)))..." "Cyan" }
    Write-Log "Boldness: $Boldness $(if ($Boldness -eq 'adaptive') { '(high->medium->low)' } else { '' })" "Cyan"
    if ($DryRun) { Write-Log "DRY RUN MODE" "Yellow" }

    # Initialize
    $state = Initialize-State
    $taskData = Load-Tasks $config

    # Create branch for this run
    $branch = "$branchPrefix-$TIMESTAMP"
    Write-Log "Creating branch: $branch" "Green"
    git checkout -b $branch 2>&1 | Out-Null

    # Generate codebase manifest once at start
    Write-Log "Generating codebase manifest..." "Cyan"
    $codebaseManifest = Generate-CodebaseManifest
    Write-Log "Manifest generated ($($codebaseManifest.Split("`n").Count) lines)" "Green"

    Write-Log "Starting. Press Ctrl+C to stop." "Yellow"
    Start-Sleep -Seconds 3

    # Main loop
    for ($i = 1; $i -le $MaxLoops; $i++) {
        $state.currentLoop = $i
        Save-State $state

        Write-LoopProgress -Loop $i -MaxLoops $MaxLoops -State $state

        # Stop conditions
        if ($state.consecutiveFailures -ge $maxFailures) {
            Write-Log "STOPPING: $maxFailures consecutive failures" "Red"
            break
        }
        if ($state.consecutiveNoOps -ge $maxNoOps) {
            Write-Log "STOPPING: $maxNoOps consecutive no-ops" "Yellow"
            break
        }

        # Build prompt
        Write-Phase "PREPARING" "Building context"
        Write-PhaseStep "Loading configuration" 1 4

        if ($Goal -or $UseVision) {
            # Goal mode (focused) or General improvement mode
            $modeLabel = if ($Goal) { "Focused goal" } else { "General improvement" }
            Write-PhaseStep "$modeLabel mode: generating prompt" 2 4

            # Refresh recent changes context each loop
            $recentChanges = Get-RecentChangesContext

            # Refresh manifest every 10 loops (in case structure changed)
            if ($i % 10 -eq 0) {
                $codebaseManifest = Generate-CodebaseManifest
            }

            $prompt = Get-GoalPrompt -goal $Goal -vision $vision -state $state -config $config -boldness $Boldness -maxLoops $MaxLoops -manifest $codebaseManifest -recentChanges $recentChanges
            $currentTaskId = "goal-$i"
            Write-PhaseStep "Prompt ready" 4 4
        } else {
            # Task queue mode (legacy)
            Write-PhaseStep "Finding next task" 2 4
            $task = Get-NextTask -taskData $taskData -riskLevel $RiskLevel
            if (-not $task) {
                Write-Log "No more tasks at risk level: $RiskLevel" "Yellow"
                break
            }
            Write-PhaseStep "Task: $($task.description.Substring(0, [Math]::Min(40, $task.description.Length)))..." 3 4
            $prompt = Get-TaskPrompt -task $task -config $config
            $currentTaskId = $task.id
            Update-TaskStatus -taskData $taskData -taskId $task.id -status "in_progress"
            Write-PhaseStep "Prompt ready" 4 4
        }

        # Snapshot HEAD before Claude runs so we can diff after
        $headBefore = Get-CurrentHead

        # Run Claude
        Write-Phase "AI WORKING" "Claude is thinking..."
        $success = $false
        $claudeOutput = ""
        $loopStartTime = Get-Date
        $aiStartTime = Get-Date
        for ($retry = 0; $retry -lt $maxRetries; $retry++) {
            try {
                if ($DryRun) {
                    Write-SpinnerDone "DRY RUN: Would run Claude" $true
                    $claudeOutput = "DRY RUN"
                    $success = $true
                } else {
                    # Show spinner while Claude works
                    $job = Start-Job -ScriptBlock {
                        param($p)
                        claude --dangerously-skip-permissions --print $p 2>&1
                    } -ArgumentList $prompt

                    $mainTimeout = 2400  # 40 minutes max for main loop
                    $timedOut = $false
                    while ($job.State -eq 'Running') {
                        $elapsed = [math]::Round(((Get-Date) - $aiStartTime).TotalSeconds)
                        if ($elapsed -gt $mainTimeout) {
                            Write-Log "Main loop timed out after ${mainTimeout}s - killing" "Yellow"
                            Stop-Job -Job $job
                            $timedOut = $true
                            break
                        }
                        Write-Spinner "Claude working... (${elapsed}s)"
                        Start-Sleep -Milliseconds 500
                    }

                    $rawOutput = Receive-Job -Job $job
                    Remove-Job -Job $job
                    if ($timedOut) {
                        Invoke-Revert
                        $claudeOutput = "TIMED OUT after ${mainTimeout}s"
                        $success = $false
                        break
                    }
                    $claudeOutput = if ($rawOutput -is [array]) { $rawOutput -join "`n" } else { "$rawOutput" }
                    if (-not $claudeOutput) { $claudeOutput = "" }
                    $elapsed = [math]::Round(((Get-Date) - $aiStartTime).TotalSeconds)
                    Write-SpinnerDone "Claude finished (${elapsed}s)" $true
                    $success = $true
                }
                break
            } catch {
                Write-SpinnerDone "Attempt $($retry + 1) failed" $false
                Write-Log "Retry $($retry + 1) of $maxRetries..." "Yellow"
                Start-Sleep -Seconds 30
            }
        }

        if (-not $success) {
            Write-Log "Failed after retries" "Red"
            $state.consecutiveFailures++
            Save-State $state
            continue
        }

        # Check output signals
        Write-Phase "ANALYZING OUTPUT" "Checking AI response"
        if ($claudeOutput -match "SKIP:\s*(.+)") {
            Write-SpinnerDone "SKIP: $($Matches[1])" $false
            $state.consecutiveNoOps++
            Save-State $state
            continue
        }
        if ($claudeOutput -match "NOOP:\s*(.+)") {
            Write-SpinnerDone "NO-OP: $($Matches[1])" $false
            $state.consecutiveNoOps++
            Save-State $state
            continue
        }
        if ($claudeOutput -match "BLOCKED:\s*(.+)") {
            Write-SpinnerDone "BLOCKED: $($Matches[1])" $false
            Add-Observation $state "Blocked - $($Matches[1])"
            $state.consecutiveNoOps++
            Save-State $state
            continue
        }
        if ($claudeOutput -match "GOAL_COMPLETE") {
            Write-SpinnerDone "GOAL COMPLETE!" $true
            break
        }
        if ($claudeOutput -match "OBSERVATION:\s*(.+)") {
            Write-Log "  Observation: $($Matches[1])" "DarkCyan"
            Add-Observation $state $Matches[1]
        }

        # Check for changes (unstaged files)
        $changedFiles = @(Get-ChangedFiles)
        $fixerSaved = $false
        $claudeCommittedDirectly = $false

        # Check if Claude already committed its own changes
        $claudeCommits = Get-CommitsSince $headBefore
        $claudeFeatureCommits = @($claudeCommits | Where-Object { $_ -notmatch "overnight: Progress" })
        if ($claudeFeatureCommits.Count -gt 0) {
            Write-Log "  Claude already committed: $($claudeFeatureCommits[0])" "Green"
            $changedFiles = @(Get-ChangedFiles)
        }

        if ($null -eq $changedFiles -or $changedFiles.Count -eq 0) {
            if ($claudeFeatureCommits.Count -gt 0) {
                # Claude committed directly -- this is a SUCCESS, not a no-op
                Write-SpinnerDone "Claude committed directly (no leftover files)" $true
                $claudeCommittedDirectly = $true
                $state.totalCommits++
                $state.consecutiveFailures = 0
                $state.consecutiveNoOps = 0
                $state.lastOutput = ""
                $state.lastFailure = ""
                if (-not $Goal) {
                    Update-TaskStatus $taskData $currentTaskId "completed"
                    $state.completedTasks += $currentTaskId
                }
                Save-State $state
                # Fall through to completion output (skip staging/commit)
            } else {
                Write-SpinnerDone "No file changes detected" $false

                # Detect "described but didn't edit" pattern
                $describedButDidntEdit = $claudeOutput.Length -gt 500 -and (
                    $claudeOutput -match "I would|I'll|I will|would change|could change|should change|changes:|summary:|modified:" -or
                    $claudeOutput -match "Done!|Shipped!|Complete!"
                )

                if ($describedButDidntEdit) {
                    Write-Log "  WARNING: Claude described changes but didn't use Edit tool!" "Yellow"
                    Write-Log "  Entering fix sub-loop to make the changes..." "Cyan"

                    $taskDescription = if ($claudeOutput.Length -gt 1000) {
                        $claudeOutput.Substring(0, 1000)
                    } else {
                        $claudeOutput
                    }

                    $fixResult = Invoke-FixLoop -MainLoop $i -ErrorMessage "The main AI described these changes but didn't actually make them. YOU must make them:`n`n$taskDescription" -Config $config -MaxSubLoops 5

                    if ($fixResult.success) {
                        Write-Log "  Fixed in $($fixResult.subLoopsUsed) sub-loop(s)!" "Green"
                        $changedFiles = @(Get-ChangedFiles)
                        $fixerSaved = $true
                    } else {
                        $state.lastFailure = "YOU DESCRIBED CHANGES BUT DIDN'T ACTUALLY EDIT ANY FILES. Fix sub-loops also failed. You must USE THE EDIT TOOL to modify code."
                        $state.consecutiveNoOps++
                        Save-State $state
                        Start-Sleep -Seconds $pauseSeconds
                        continue
                    }
                } else {
                    # Normal no-op
                    $truncatedOutput = if ($claudeOutput.Length -gt 2000) {
                        $claudeOutput.Substring(0, 2000) + "... [truncated]"
                    } else {
                        $claudeOutput
                    }
                    $state.lastOutput = $truncatedOutput
                    # Don't count observation-only loops as no-ops (v3.1 fix)
                    if ($claudeOutput -match "OBSERVATION:") {
                        Write-Log "  Observation-only loop (not counted as no-op)" "DarkCyan"
                    } else {
                        $state.consecutiveNoOps++
                    }
                    Write-Log "  Claude's output saved for next loop context" "DarkGray"
                    Save-State $state
                    Start-Sleep -Seconds $pauseSeconds
                    continue
                }
            }
        }

        # If we get here with no changes and fixer didn't save us (and Claude didn't commit directly), skip
        if (($null -eq $changedFiles -or $changedFiles.Count -eq 0) -and -not $fixerSaved -and -not $claudeCommittedDirectly) {
            Write-Log "  Unexpected state - no changes" "Red"
            continue
        }

        if (-not $claudeCommittedDirectly) {
        Write-Phase "CHANGES DETECTED" "$($changedFiles.Count) files modified"

        # Quality gates
        if (-not $DryRun) {
            $gateResult = Invoke-QualityGates $config
            if (-not $gateResult.passed) {
                Write-SpinnerDone "Quality gates failed - entering fix sub-loop" $false
                Invoke-Revert

                # Extract what Claude was trying to do from the commit message
                $lastCommitMsg = ""
                Push-Location $PROJECT_ROOT
                try { $lastCommitMsg = (git log -1 --format="%s" 2>&1).Trim() } catch {} finally { Pop-Location }

                # Enter fix sub-loop (1.1, 1.2, 1.3... up to 1.20)
                $fixResult = Invoke-FixLoop -MainLoop $i -ErrorMessage $gateResult.error -Config $config -MaxSubLoops 20 -AttemptedChange "The main AI was trying to: $lastCommitMsg"

                if ($fixResult.success) {
                    Write-Log "  Fixed in $($fixResult.subLoopsUsed) sub-loop(s)!" "Green"
                    # Continue to staging/commit with the fixed files
                    $changedFiles = @(Get-ChangedFiles)
                } else {
                    # Fix loop exhausted - move on to next main loop
                    Write-Log "  Could not fix after $($fixResult.subLoopsUsed) attempts - moving on" "Yellow"
                    $state.consecutiveFailures++
                    $state.lastFailure = $gateResult.error
                    Save-State $state
                    Start-Sleep -Seconds $pauseSeconds
                    continue
                }
            }
        }

        # Stage and commit
        Write-Phase "COMMITTING" "Staging files"
        $staging = Invoke-SmartStaging $config
        if ($staging.staged.Count -eq 0) {
            Write-SpinnerDone "No files staged" $false
            Invoke-Revert
            $state.consecutiveNoOps++
            Save-State $state
            continue
        }

        Write-PhaseStep "Staged $($staging.staged.Count) files" 1 2

        $commitMsg = if ($Goal -or $UseVision) { "overnight: Progress (loop $i)" } else { "overnight: $($task.description)" }

        if (-not $DryRun) {
            Write-PhaseStep "Creating commit" 2 2
            if (Invoke-Commit $commitMsg) {
                $state.totalCommits++
                $state.consecutiveFailures = 0
                $state.consecutiveNoOps = 0
                $state.lastOutput = ""  # Clear on success
                $state.lastFailure = ""  # Clear on success
                if (-not $Goal) {
                    Update-TaskStatus $taskData $currentTaskId "completed"
                    $state.completedTasks += $currentTaskId
                }
                Write-SpinnerDone "Loop $i complete!" $true
            }
        } else {
            Write-SpinnerDone "DRY RUN: Would commit" $true
        }

        Save-State $state
        } # end if (-not $claudeCommittedDirectly)

        # Detailed completion output
        $loopElapsed = [math]::Round(((Get-Date) - $loopStartTime).TotalSeconds)
        $commitsSince = Get-CommitsSince $headBefore
        $filesSince = Get-FilesSince $headBefore

        # Extract observation for this loop (if any)
        $loopObs = ""
        if ($claudeOutput -match "OBSERVATION:\s*(.+)") {
            $loopObs = $Matches[1]
        }

        # Get the feature commit message (the one Claude wrote, not the progress commit)
        $featureCommit = ""
        foreach ($c in $commitsSince) {
            if ($c -notmatch "overnight: Progress") {
                $featureCommit = $c
                break
            }
        }

        # Log the feature commit message (v3.1 fix)
        if ($featureCommit) {
            Write-Log "  Feature: $featureCommit" "Green"
        }

        # Save completion info to state
        $completionEntry = "Loop ${i}: $featureCommit ($($filesSince.Count) files, ${loopElapsed}s)"
        $state.loopCompletions += $completionEntry
        Save-State $state

        Write-LoopCompletion -Loop $i -Commits $commitsSince -Files $filesSince -Observation $loopObs -ElapsedSeconds $loopElapsed

        $commitCount = Get-CommitCount $config
        Write-Host "  Running totals: $commitCount commits | $($state.completedTasks.Count) loops done" -ForegroundColor DarkGray
        Write-Host ""

        Write-Log "Pausing ${pauseSeconds}s before next loop..." "DarkGray"
        Start-Sleep -Seconds $pauseSeconds
    }

    # Self-improvement phase (runs after main loop, never during)
    if (-not $DryRun) {
        Invoke-SelfImprovement
    }

    # Report
    Write-Banner "EXPERIMENT COMPLETE"
    $report = New-MorningReport $state $taskData $config
    Write-Host $report
    Write-Log "Branch: $branch" "Cyan"
}

# =============================================================================
# RUN
# =============================================================================

try {
    Start-OvernightExperiment
} catch {
    Write-Log "Fatal error: $_" "Red"
    try {
        $config = Load-ProjectConfig
        $state = Load-State
        $taskData = Load-Tasks $config
        New-MorningReport $state $taskData $config
    } catch {
        Write-Log "Could not generate report: $_" "Red"
    }
}
