# Deploy citation-testing to Cloud Run (no local Docker required).
# Cloud Build builds from source using buildpacks + Procfile.
#
# Prerequisites: gcloud CLI, logged in, project set.
# Set secrets/env in Cloud Run console or pass --set-env-vars / --set-secrets.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$ServiceName = if ($env:CITATION_TESTING_SERVICE_NAME) { $env:CITATION_TESTING_SERVICE_NAME } else { "citation-testing" }
$Region = if ($env:CLOUD_RUN_REGION) { $env:CLOUD_RUN_REGION } else { "asia-south1" }

Write-Host "Deploying $ServiceName to Cloud Run ($Region) from source..."
gcloud run deploy $ServiceName `
  --source . `
  --region $Region `
  --platform managed `
  --allow-unauthenticated `
  --timeout 300 `
  --memory 2Gi `
  --cpu 2 `
  --min-instances 0 `
  --max-instances 10

Write-Host "Done. Set env vars in Cloud Run if not already configured:"
Write-Host "  GEMINI_API_KEY, ANTHROPIC_API_KEY, SERPER_API_KEY, AGENTIC_DOCUMENT_SERVICE_URL, CORS_ORIGINS"
