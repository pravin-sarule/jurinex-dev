# Run all Jurinex backend services (each in a new window)
# Run from repo root: powershell -ExecutionPolicy Bypass -File .\Backend\run-all-backends.ps1

$root = if ($PSScriptRoot) {
    Split-Path -Parent $PSScriptRoot
} else {
    (Get-Location).Path
}
$backend = Join-Path $root "Backend"

Write-Host "Starting all backend services (root: $root)" -ForegroundColor Cyan

# ---- Node services ----
$nodeServices = @(
    @{ Name = "Gateway"; Path = "gateway-service"; Port = "5000" },
    @{ Name = "Auth"; Path = "authservice"; Port = "5001" },
    @{ Name = "Document"; Path = "document-service"; Port = "8080" },
    @{ Name = "Payment"; Path = "payment-service"; Port = "5003" },
    @{ Name = "Translation"; Path = "Translation-service"; Port = "3000" },
    @{ Name = "Zoho"; Path = "zoho-service"; Port = "5006" },
    @{ Name = "Drafting (Google)"; Path = "drafting-service"; Port = "5005" },
    @{ Name = "Draft (MS Word)"; Path = "draft-service"; Port = "4000" },
    @{ Name = "ChatModel"; Path = "ChatModel"; Port = "5007" }
)

foreach ($s in $nodeServices) {
    $dir = Join-Path (Join-Path $root "Backend") $s.Path
    if (-not (Test-Path $dir)) {
        Write-Host "Skip $($s.Name): not found" -ForegroundColor Yellow
        continue
    }
    $title = "Jurinex - $($s.Name) ($($s.Port))"
    $cmd = "Set-Location '$dir'; `$env:PORT='$($s.Port)'; npm start; pause"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Write-Host '$title' -ForegroundColor Green; $cmd"
    Start-Sleep -Milliseconds 350
}

# ---- Python services ----
$pyServices = @(
    @{ Name = "Citation"; Path = "citation-service"; Port = "8001"; Cmd = "python -m uvicorn main:app --host 0.0.0.0 --port 8001" },
    @{ Name = "Agent-Draft"; Path = "agent-draft-service"; Port = "8000"; Cmd = "python -m uvicorn main:app --host 0.0.0.0 --port 8000" },
    @{ Name = "Visual"; Path = "Visual-Service"; Port = "8081"; Cmd = "python main.py" },
    @{ Name = "Template Analyzer"; Path = "Template Analyzer Agent"; Port = "5017"; Cmd = "python -m uvicorn main:app --host 0.0.0.0 --port 5017" }
)

foreach ($s in $pyServices) {
    $dir = Join-Path (Join-Path $root "Backend") $s.Path
    if (-not (Test-Path $dir)) {
        Write-Host "Skip $($s.Name): not found" -ForegroundColor Yellow
        continue
    }
    $title = "Jurinex - $($s.Name) ($($s.Port))"
    $cmd = "Set-Location '$dir'; `$env:PORT='$($s.Port)'; $($s.Cmd); pause"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Write-Host '$title' -ForegroundColor Green; $cmd"
    Start-Sleep -Milliseconds 350
}

Write-Host "`nAll backend service windows started." -ForegroundColor Green
Write-Host "Ports: 5000 Gateway | 5001 Auth | 5003 Payment | 5005 Drafting | 5006 Zoho | 4000 Draft(MS) | 3000 Translation | 5007 ChatModel | 8080 Document | 8000 Agent-Draft | 8001 Citation | 8081 Visual | 5017 Template Analyzer"
