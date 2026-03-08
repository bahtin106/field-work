# PowerShell deploy script for display_url migration and yandex-disk functions
# Usage: Set environment variables below or pass via process environment.

# Prerequisites:
# - supabase CLI installed and authenticated
# - psql available (or use supabase CLI for migrations)
# - SERVICE ROLE KEY, SUPABASE_URL, DATABASE_URL set in env

if (-not $env:SUPABASE_URL) { Write-Error "SUPABASE_URL not set"; exit 1 }
if (-not $env:SUPABASE_SERVICE_ROLE_KEY -and -not $env:SERVICE_ROLE_KEY) { Write-Error "SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY) not set"; exit 1 }

# 1) Apply SQL migration (idempotent)
Write-Host "Applying SQL migration..."
# Prefer using supabase CLI if available
if (Get-Command supabase -ErrorAction SilentlyContinue) {
  supabase db push --schema supabase/migrations
} else {
  if (-not $env:DATABASE_URL) { Write-Error "DATABASE_URL not set; cannot apply migration without supabase CLI"; exit 1 }
  psql $env:DATABASE_URL -f "supabase/migrations/20260304120000_add_display_url_to_order_media_external_map.sql"
}

# 2) Deploy updated yandex-disk-media function
Write-Host "Deploying function yandex-disk-media..."
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) { Write-Error "supabase CLI not found; install it to deploy functions"; exit 1 }
supabase functions deploy yandex-disk-media --project-ref $env:SUPABASE_PROJECT_REF

# 3) Optionally deploy reconcile function (if exists)
if (Test-Path "supabase/functions/yandex-disk-reconcile") {
  Write-Host "Deploying reconcile function..."
  supabase functions deploy yandex-disk-reconcile --project-ref $env:SUPABASE_PROJECT_REF
}

# 4) Run reconcile once to pre-generate display_url for existing records
# This may be expensive; it's best to run on maintenance window. The function should accept pagination.
$runReconcile = Read-Host "Run reconcile now? (y/n)"
if ($runReconcile -eq 'y') {
  # If using supabase CLI function invocation (may vary by CLI version)
  try {
    supabase functions invoke yandex-disk-reconcile --project-ref $env:SUPABASE_PROJECT_REF --payload '{"limit":100}'
  } catch {
    Write-Host "Fallback: invoke via curl to the function URL"
    if (-not $env:SUPABASE_URL -or -not $env:SUPABASE_ANON_KEY) { Write-Warning "SUPABASE_URL or SUPABASE_ANON_KEY missing for HTTP invoke" } else {
      $url = "$env:SUPABASE_URL/functions/v1/yandex-disk-reconcile"
      curl -X POST $url -H "apikey: $env:SUPABASE_ANON_KEY" -H "Authorization: Bearer $env:SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d '{"limit":100}'
    }
  }
}

Write-Host "Done. Verify logs and test client."