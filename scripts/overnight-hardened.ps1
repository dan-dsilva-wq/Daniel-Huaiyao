# =============================================================================
# OVERNIGHT AI EXPERIMENT v2.4 - With Fix Sub-Loops
# =============================================================================
# Usage:
#   .\scripts\overnight-hardened.ps1                           # Default run
#   .\scripts\overnight-hardened.ps1 -MaxLoops 5               # Short test
#   .\scripts\overnight-hardened.ps1 -Goal "Make it awesome"   # Goal mode
#   .\scripts\overnight-hardened.ps1 -UseVision                # Use vision file
#   .\scripts\overnight-hardened.ps1 -DryRun                   # Test without changes
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
if (-not $SCRIPT_DIR) { $SCRIPT_DIR = "C:\Users\dan-d\Projects\Website\Daniel\rise\scripts" }
$PROJECT_ROOT = (Resolve-Path "$SCRIPT_DIR\..").Path
$CONFIG_FILE = "$SCRIPT_DIR\project-config.json"
$STATE_FILE = "$SCRIPT_DIR\state.json"
$TASK_FILE = "$SCRIPT_DIR\$TaskFile"
$LOG_DIR = "$SCRIPT_DIR\logs"
$REPORT_DIR = "$SCRIPT_DIR\reports"

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
                    "migrations/", "\.secret", "credentials", "node_modules/"
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
        # Ensure arrays are not null
        if ($null -eq $state.observations) { $state.observations = @() }
        if ($null -eq $state.completedTasks) { $state.completedTasks = @() }
        if ($null -eq $state.failedTasks) { $state.failedTasks = @() }
        if ($null -eq $state.skippedTasks) { $state.skippedTasks = @() }
        if ($null -eq $state.reviewRequired) { $state.reviewRequired = @() }
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

    $fixerPrompt = @"
You are the FIXER AI. The main AI failed. Your ONLY job is to fix this specific error.

ERROR TO FIX:
$ErrorMessage

CONTEXT:
$Context

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
            while ($job.State -eq 'Running') {
                $elapsed = [math]::Round(((Get-Date) - $fixerStartTime).TotalSeconds)
                Write-Spinner "Fixer working... (${elapsed}s)"
                Start-Sleep -Milliseconds 500
            }

            $rawOutput = Receive-Job -Job $job
            Remove-Job -Job $job
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
        [int]$MaxSubLoops = 10
    )

    Write-Phase "FIX MODE" "Entering sub-loop to fix error"

    # Very minimal prompt - just fix the error
    $fixPrompt = @"
FIX THIS ERROR NOW:

$ErrorMessage

INSTRUCTIONS:
1. Read the file at the line mentioned
2. USE THE EDIT TOOL to fix it
3. git add <file>
4. git commit -m "Fix: [brief description]"

RULES:
- Use Edit tool. Not Write. Not describe. EDIT.
- Fix ONLY this error
- No refactoring, no improvements
- If truly impossible: BLOCKED: [reason]

GO.
"@

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

            while ($job.State -eq 'Running') {
                $elapsed = [math]::Round(((Get-Date) - $subStartTime).TotalSeconds)
                Write-Spinner "Sub-loop $loopLabel working... (${elapsed}s)"
                Start-Sleep -Milliseconds 500
            }

            $rawOutput = Receive-Job -Job $job
            Remove-Job -Job $job
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
                Write-Log "    No changes made, retrying..." "Yellow"
                # Update prompt with feedback
                $fixPrompt = @"
FIX THIS ERROR NOW:

$ErrorMessage

YOUR LAST ATTEMPT MADE NO CHANGES. You must USE THE EDIT TOOL.

Do NOT describe the fix. Do NOT explain. USE THE EDIT TOOL.

1. Read the file
2. EDIT the specific line
3. git add && git commit

GO. EDIT NOW.
"@
                continue
            }

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
                # Update prompt with new error
                $fixPrompt = @"
FIX THIS ERROR NOW:

$($gateResult.error)

Your previous fix attempt didn't work. Try a different approach.

1. Read the file
2. EDIT the line
3. git add && git commit

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

# =============================================================================
# PROMPTS
# =============================================================================

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

function Get-GoalPrompt {
    param([string]$goal, [string]$vision, $state, $config, [string]$boldness, [int]$maxLoops)

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
- Previous loops already did work (see observations). BUILD ON IT, don't repeat it.

QUICK SCAN (then act):
- Glance at src/ structure
- Read $exploreFiles relevant files to understand the flow
- Find a GAP - something missing that users would love
- Build it

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

    $report = @"
# Overnight Report - $projectName - $(Get-Date -Format "yyyy-MM-dd")

## Summary
- **Started:** $($startTime.ToString("h:mm tt"))
- **Ended:** $($endTime.ToString("h:mm tt"))
- **Duration:** $([math]::Round($duration.TotalHours, 1)) hours
- **Loops:** $($state.currentLoop)
- **Commits:** $($state.totalCommits)

## Completed
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
*Generated by Overnight AI Experiment v2.4*
"@

    if (-not (Test-Path $REPORT_DIR)) { New-Item -ItemType Directory -Path $REPORT_DIR -Force | Out-Null }
    $report | Set-Content $REPORT_FILE
    Write-Log "Report saved: $REPORT_FILE" "Green"
    return $report
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

    Write-Banner "OVERNIGHT AI EXPERIMENT v2.4 - With Fix Sub-Loops"
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
            $prompt = Get-GoalPrompt -goal $Goal -vision $vision -state $state -config $config -boldness $Boldness -maxLoops $MaxLoops
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

        # Run Claude
        Write-Phase "AI WORKING" "Claude is thinking..."
        $success = $false
        $claudeOutput = ""
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

                    while ($job.State -eq 'Running') {
                        $elapsed = [math]::Round(((Get-Date) - $aiStartTime).TotalSeconds)
                        Write-Spinner "Claude working... (${elapsed}s)"
                        Start-Sleep -Milliseconds 500
                    }

                    $rawOutput = Receive-Job -Job $job
                    Remove-Job -Job $job
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

        # Check for changes
        $changedFiles = @(Get-ChangedFiles)
        $fixerSaved = $false

        if ($null -eq $changedFiles -or $changedFiles.Count -eq 0) {
            Write-SpinnerDone "No file changes detected" $false

            # Detect "described but didn't edit" pattern
            $describedButDidntEdit = $claudeOutput.Length -gt 500 -and (
                $claudeOutput -match "I would|I'll|I will|would change|could change|should change|changes:|summary:|modified:" -or
                $claudeOutput -match "Done!|Shipped!|Complete!"
            )

            if ($describedButDidntEdit) {
                Write-Log "  WARNING: Claude described changes but didn't use Edit tool!" "Yellow"
                Write-Log "  Entering fix sub-loop to make the changes..." "Cyan"

                # Extract what the main AI claimed it wanted to do
                $taskDescription = if ($claudeOutput.Length -gt 1000) {
                    $claudeOutput.Substring(0, 1000)
                } else {
                    $claudeOutput
                }

                # Use fix sub-loop to actually make the changes
                $fixResult = Invoke-FixLoop -MainLoop $i -ErrorMessage "The main AI described these changes but didn't actually make them. YOU must make them:`n`n$taskDescription" -Config $config -MaxSubLoops 5

                if ($fixResult.success) {
                    Write-Log "  Fixed in $($fixResult.subLoopsUsed) sub-loop(s)!" "Green"
                    $changedFiles = @(Get-ChangedFiles)
                    $fixerSaved = $true
                } else {
                    # Sub-loops couldn't do it either
                    $state.lastFailure = "YOU DESCRIBED CHANGES BUT DIDN'T ACTUALLY EDIT ANY FILES. Fix sub-loops also failed. You must USE THE EDIT TOOL to modify code."
                    $state.consecutiveNoOps++
                    Save-State $state
                    Start-Sleep -Seconds $pauseSeconds
                    continue
                }
            } else {
                # Normal no-op (didn't even try)
                # Save what Claude said so we can feed it back next loop
                $truncatedOutput = if ($claudeOutput.Length -gt 2000) {
                    $claudeOutput.Substring(0, 2000) + "... [truncated]"
                } else {
                    $claudeOutput
                }
                $state.lastOutput = $truncatedOutput
                $state.consecutiveNoOps++
                Write-Log "  Claude's output saved for next loop context" "DarkGray"
                Save-State $state
                Start-Sleep -Seconds $pauseSeconds
                continue
            }
        }

        # If we get here with no changes and fixer didn't save us, something is wrong
        if (($null -eq $changedFiles -or $changedFiles.Count -eq 0) -and -not $fixerSaved) {
            Write-Log "  Unexpected state - no changes" "Red"
            continue
        }

        Write-Phase "CHANGES DETECTED" "$($changedFiles.Count) files modified"

        # Quality gates
        if (-not $DryRun) {
            $gateResult = Invoke-QualityGates $config
            if (-not $gateResult.passed) {
                Write-SpinnerDone "Quality gates failed - entering fix sub-loop" $false
                Invoke-Revert

                # Enter fix sub-loop (1.1, 1.2, 1.3... up to 1.10)
                $fixResult = Invoke-FixLoop -MainLoop $i -ErrorMessage $gateResult.error -Config $config -MaxSubLoops 20

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
        $commitCount = Get-CommitCount $config

        # Summary for this loop
        Write-Host ""
        Write-Host "  [LOOP $i SUMMARY]" -ForegroundColor Green
        Write-Host "  Total Commits: $commitCount | Tasks Done: $($state.completedTasks.Count)" -ForegroundColor Gray
        Write-Host ""

        Write-Log "Pausing ${pauseSeconds}s before next loop..." "DarkGray"
        Start-Sleep -Seconds $pauseSeconds
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
