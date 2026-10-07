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
function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Call($method, $path, $body, $as = $script:session) {
    $params = @{ Method = $method; Uri = "$Api$path"; WebSession = $as; ContentType = 'application/json' }
    if ($null -ne $body) { $params.Body = ($body | ConvertTo-Json -Depth 5) }
    Invoke-RestMethod @params
}
function SignIn($who) {
    $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    Call POST '/api/auth/sign-in' @{ tenant = 'demo'; email = $who; password = $Password } $s | Out-Null
    $s
}

Step "Sign in as $Email"
$session = SignIn $Email
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
# A small but real one-page PDF, so the release can be stamped.
function New-Pdf($text) {
    $content = "BT /F1 18 Tf 60 760 Td ($text) Tj ET"
    $objects = @(
        '<< /Type /Catalog /Pages 2 0 R >>'
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'
        "<< /Length $($content.Length) >>`nstream`n$content`nendstream"
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    )
    $pdf = "%PDF-1.4`n"
    $offsets = @()
    for ($i = 0; $i -lt $objects.Count; $i++) {
        $offsets += $pdf.Length
        $pdf += "$($i + 1) 0 obj`n$($objects[$i])`nendobj`n"
    }
    $xref = $pdf.Length
    $pdf += "xref`n0 $($objects.Count + 1)`n0000000000 65535 f `n"
    foreach ($o in $offsets) { $pdf += ("{0:D10} 00000 n `n" -f $o) }
    $pdf += "trailer`n<< /Size $($objects.Count + 1) /Root 1 0 R >>`nstartxref`n$xref`n%%EOF`n"
    # The comma keeps PowerShell from unrolling the array into separate numbers.
    ,[System.Text.Encoding]::ASCII.GetBytes($pdf)
}
[byte[]]$bytes = New-Pdf $title
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

Step 'Send it for review (the route: discipline check, then approval)'
$review = Call POST "/api/projects/$($project.id)/revisions/$($revision.id)/reviews" @{}
Write-Host "$($review.number) on route '$($review.route)'"
foreach ($s in $review.steps) { Write-Host ("  step {0}: {1} ({2}), due {3}" -f $s.number, $s.title, $s.function, $s.dueDate) }

Step 'Step 1: the engineer checks and leaves a comment'
Call POST "/api/projects/$($project.id)/reviews/$($review.id)/comments" @{ text = 'Show the north arrow on sheet 1.'; class = 'NON_BLOCKING' } | Out-Null
$review = Call POST "/api/projects/$($project.id)/reviews/$($review.id)/answer" @{}
Write-Host "Advice: $($review.steps[0].answer) (read off the comments, not chosen)"

Step 'Step 2: the approver decides'
$approver = SignIn 'approver@demo.local'
$review = Call POST "/api/projects/$($project.id)/reviews/$($review.id)/answer" @{ verdict = 'C2'; status = 'IFC' } $approver
Write-Host "Verdict $($review.verdict), granting $($review.grantedStatus); review is $($review.state)"

Step 'Document Control releases it'
$control = SignIn 'controller@demo.local'
$review = Call POST "/api/projects/$($project.id)/reviews/$($review.id)/release" @{} $control
Write-Host "Review $($review.state) by $($review.closedBy)"

Step 'The worker stamps the released PDF'
$waited = 0
do {
    Start-Sleep -Seconds 1
    $waited++
    $current = (Call GET "/api/projects/$($project.id)/documents/$($doc.id)").revisions[0]
    $stamped = $current.files | Where-Object { $_.kind -eq 'STAMPED' }
} while (-not $stamped -and $waited -lt 60)
if ($stamped) {
    Write-Host "Revision $($current.value) is $($current.state) at $($current.statusCode); stamped copy: $($stamped.name)"
    $link = Call GET "/api/projects/$($project.id)/files/$($stamped.id)/download"
    $out = Join-Path ([System.IO.Path]::GetTempPath()) 'delios-stamped.pdf'
    Invoke-WebRequest -Uri $link.url -OutFile $out -UseBasicParsing
    Write-Host "Saved to $out (open it: the stamp is in the top right corner)"
} else {
    Write-Host "Revision $($current.value) is $($current.state) at $($current.statusCode); no stamped copy after 60 s. Is the worker running?" -ForegroundColor Yellow
}

Step 'The register'
foreach ($d in (Call GET "/api/projects/$($project.id)/documents").items) {
    Write-Host ('{0,-24} rev {1,-2} {2,-15} {3}' -f $d.number, $d.latestRevision, $d.latestRevisionState, $d.title)
}
