# Citation Testing Service — runs on port 8003
# First run: creates .venv and installs requirements.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".venv\Scripts\uvicorn.exe")) {
  Write-Host "Creating virtual environment..."
  python -m venv .venv
  Write-Host "Installing requirements..."
  .venv\Scripts\pip install -r requirements.txt
}

Write-Host "Starting citation-testing service on http://localhost:8003 ..."
.venv\Scripts\uvicorn.exe main:app --host 0.0.0.0 --port 8003 --reload
