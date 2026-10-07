# Walks through the API as a person would, so the backend can be seen working
# before the Next.js screens are connected. Needs the stack running and the
# demo tenant seeded (see README "Backend").
#
#   powershell -ExecutionPolicy Bypass -File deploy\demo.ps1
param(
    [string]$Api = 'http://localhost:8080',
    [string]$Email = 'engineer@demo.local',
    [string]$Password = 'demo1234'
)
$ErrorActionPreference = 'Stop'
try { Invoke-WebRequest -Uri "$Api/api/me" -UseBasicParsing -ErrorAction Stop | Out-Null }
catch {
    if (-not $_.Exception.Response) {
        Write-Host "Nothing answers at $Api. Start the backend first:" -ForegroundColor Yellow
        Write-Host '  docker compose -f deploy/compose.yaml --profile app up -d --build'
        Write-Host '  docker compose -f deploy/compose.yaml ps        (api and worker should say healthy)'
        exit 1
    }
}
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Call($method, $path, $body) {
    $params = @{ Method = $method; Uri = "$Api$path"; WebSession = $session; ContentType = 'application/json' }
    if ($null -ne $body) { $params.Body = ($body | ConvertTo-Json -Depth 5) }
    Invoke-RestMethod @params
}

Step "Sign in as $Email"
Call POST '/api/auth/sign-in' @{ tenant = 'demo'; email = $Email; password = $Password } | Out-Null
$me = Call GET '/api/me'
$project = $me.projects[0]
Write-Host "$($me.user.name), $($project.function.name) on $($project.code) $($project.name)"
Write-Host "May: $($project.verbs -join ', ')"

Step 'Register a document (the number is allocated by the system)'
$title = "Inlet works general arrangement $(Get-Date -Format 'HHmmss')"
$doc = Call POST "/api/projects/$($project.id)/documents" @{
    title = $title; deliverableType = 'ENG'; docType = 'DWG'; discipline = 'CI'; subproject = '10'
}
Write-Host "$($doc.number)  $($doc.title)  state $($doc.state)"

Step 'Upload a PDF straight to storage'
$bytes = [System.Text.Encoding]::ASCII.GetBytes("%PDF-1.7`n$title`n%%EOF`n")
$hasher = [System.Security.Cryptography.SHA256]::Create()
$sha = -join ($hasher.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') })
$ticket = Call POST "/api/projects/$($project.id)/documents/$($doc.id)/uploads" @{
    fileName = 'GA.pdf'; size = $bytes.Length; contentType = 'application/pdf'; sha256 = $sha
}
Invoke-WebRequest -Method PUT -Uri $ticket.url -Body $bytes -ContentType 'application/pdf' -UseBasicParsing | Out-Null
Write-Host "Stored as file $($ticket.fileId)"

Step 'Start revision A with that file'
$revision = Call POST "/api/projects/$($project.id)/documents/$($doc.id)/revisions" @{ fileIds = @($ticket.fileId) }
Write-Host "Revision $($revision.value): files $($revision.filesState)"

Step 'Wait for the worker to scan and check it'
do {
    Start-Sleep -Seconds 1
    $current = (Call GET "/api/projects/$($project.id)/documents/$($doc.id)").revisions[0]
} while ($current.filesState -eq 'PROCESSING')
$file = $current.files[0]
Write-Host "Revision $($current.value): files $($current.filesState); $($file.name) is $($file.status), detected as $($file.detectedType)"

Step 'Download it back'
$link = Call GET "/api/projects/$($project.id)/files/$($ticket.fileId)/download"
$saved = Join-Path ([System.IO.Path]::GetTempPath()) 'delios-demo.pdf'
Invoke-WebRequest -Uri $link.url -OutFile $saved -UseBasicParsing
$back = [System.IO.File]::ReadAllBytes($saved)
$same = [System.Linq.Enumerable]::SequenceEqual([byte[]]$bytes, [byte[]]$back)
Write-Host "Downloaded $($back.Length) bytes; identical to the upload: $same"

Step 'The register'
foreach ($d in (Call GET "/api/projects/$($project.id)/documents").items) {
    Write-Host ('{0,-24} rev {1,-2} {2,-15} {3}' -f $d.number, $d.latestRevision, $d.latestRevisionState, $d.title)
}
