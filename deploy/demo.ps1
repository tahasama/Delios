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

Step 'Released, never sent: nobody has been told yet'
$waiting = Call GET "/api/projects/$($project.id)/not-issued" $null $control
$mine = $waiting | Where-Object { $_.revisionId -eq $revision.id }
Write-Host "$($mine.documentNumber) rev $($mine.revision) at $($mine.status): not issued"

Step 'The engineer asks for it to go to the viewers, for information'
$distribution = Call GET "/api/projects/$($project.id)/documents/$($doc.id)/distribution"
Write-Host "The matrix proposes: $(($distribution.proposed | ForEach-Object { $_.name }) -join ', ')"
$viewer = $distribution.proposed | Where-Object { $_.name -eq 'Victor Viewer' }
$asked = Call POST "/api/projects/$($project.id)/revisions/$($revision.id)/issue-requests" @{
    reason = 'INFORMATION'; userIds = @($viewer.id); note = 'For the site file.'
}
Write-Host "Request $($asked.request.status): $($asked.request.reason), waiting for Document Control"

Step 'Document Control sends it'
$sent = Call POST "/api/projects/$($project.id)/issue-requests/$($asked.request.id)/carry-out" @{} $control
Write-Host "Transmittal $($sent.transmittals -join ', ')"

Step 'The viewer opens it and acknowledges it'
$viewerSession = SignIn 'viewer@demo.local'
$inbox = Call GET "/api/projects/$($project.id)/transmittals" $null $viewerSession
$transmittal = Call POST "/api/projects/$($project.id)/transmittals/$($inbox[0].id)/acknowledge" @{} $viewerSession
$r = $transmittal.recipients[0]
Write-Host "$($transmittal.number) to $($r.name): opened $($r.openedAt), acknowledged $($r.acknowledgedAt)"

Step 'A high-criticality drawing goes to the client for approval'
function Upload($path, $name, [byte[]]$data, $as = $script:session, $type = 'application/pdf') {
    $hash = -join ($hasher.ComputeHash($data) | ForEach-Object { $_.ToString('x2') })
    $t = Call POST $path @{ fileName = $name; size = $data.Length; contentType = $type; sha256 = $hash } $as
    Invoke-WebRequest -Method PUT -Uri $t.url -Body $data -ContentType $type -UseBasicParsing | Out-Null
    $t.fileId
}
$pfdTitle = "Inlet works process flow diagram $(Get-Date -Format 'HHmmss')"
$pfd = Call POST "/api/projects/$($project.id)/documents" @{
    title = $pfdTitle; deliverableType = 'ENG'; docType = 'DWG'; discipline = 'PR'; subproject = '20'; criticality = 'A'
}
[byte[]]$pfdBytes = New-Pdf $pfdTitle
$pfdFile = Upload "/api/projects/$($project.id)/documents/$($pfd.id)/uploads" 'PFD.pdf' $pfdBytes
$pfdRevision = Call POST "/api/projects/$($project.id)/documents/$($pfd.id)/revisions" @{ fileIds = @($pfdFile) }
do {
    Start-Sleep -Seconds 1
    $current = (Call GET "/api/projects/$($project.id)/documents/$($pfd.id)").revisions[0]
} while ($current.filesState -eq 'PROCESSING')
$clientReview = Call POST "/api/projects/$($project.id)/revisions/$($pfdRevision.id)/reviews" @{}
Write-Host "$($pfd.number): $($clientReview.number) on route '$($clientReview.route)'"
foreach ($s in $clientReview.steps) {
    $who = if ($s.party) { "$($s.party), $($s.participation)" } else { $s.function }
    Write-Host ("  step {0}: {1} ({2})" -f $s.number, $s.title, $who)
}
$clientReview = Call POST "/api/projects/$($project.id)/reviews/$($clientReview.id)/answer" @{}

Step 'The client works in its own portal: Document Control sends it and records that it went'
$clientReview = Call POST "/api/projects/$($project.id)/reviews/$($clientReview.id)/dispatch" @{
    channel = 'Client portal'; reference = 'NWU-SUB-0042'
} $control
$clientStep = $clientReview.steps[1]
$carried = Call GET "/api/projects/$($project.id)/transmittals/$($clientStep.transmittalId)" $null $control
Write-Host "Sent on $($carried.number) by $($clientStep.dispatchChannel), their reference $($clientStep.dispatchRef); answer due $($clientStep.dueDate)"

Step "The client's answer comes back: Document Control records it, with their stamped copy as proof"
[byte[]]$proofBytes = New-Pdf 'Northwater Utility - Code 1 - Approved'
$proof = Upload "/api/projects/$($project.id)/reviews/$($clientReview.id)/evidence" 'client-stamped.pdf' $proofBytes $control
$clientReview = Call POST "/api/projects/$($project.id)/reviews/$($clientReview.id)/answer" @{
    verdict = 'C1'; status = 'AFC'; foreignAnswer = 'Code 1: approved'; evidenceFileId = $proof
} $control
$clientStep = $clientReview.steps[1]
Write-Host "Verdict $($clientReview.verdict), granting $($clientReview.grantedStatus); they wrote '$($clientStep.foreignAnswer)'; recorded by $($clientStep.recordedBy)"
$clientReview = Call POST "/api/projects/$($project.id)/reviews/$($clientReview.id)/release" @{} $control
Write-Host "Released: $($clientReview.state)"

Step 'A package: both drawings, delivered to the client together'
$people = @($distribution.proposed) + @($distribution.others)
$engineerId = ($people | Where-Object { $_.name -eq 'Eli Engineer' }).id
$approverId = ($people | Where-Object { $_.name -eq 'Aisha Approver' }).id
$clientId = ($distribution.parties | Where-Object { $_.code -eq 'NWU' }).id
$package = Call POST "/api/projects/$($project.id)/packages" @{
    title = 'Inlet works construction set'; reason = 'EXECUTION'; requiredStatuses = @('IFC', 'AFC')
    ownerIds = @($engineerId); acceptorIds = @($approverId); recipientPartyIds = @($clientId)
}
$pk = "/api/projects/$($project.id)/packages/$($package.id)"
$package = Call POST "$pk/members" @{ documentIds = @($doc.id, $pfd.id) }
$package = Call POST "$pk/assess" @{}
Write-Host "$($package.number) $($package.title): Eli puts it together, Aisha accepts it"
foreach ($m in $package.members) { Write-Host ("  {0,-24} rev {1} at {2,-4} ready: {3}" -f $m.documentNumber, $m.revision, $m.status, $m.ready) }
$package = Call POST "$pk/deliver" @{ note = 'Construction set for the inlet works.' }
Write-Host "$($package.state) on $($package.transmittals -join ', ')"
$work = Call GET "/api/projects/$($project.id)/work" $null $control
$job = @($work.issues) | Where-Object { $_.kind -eq 'DISPATCH_TRANSMITTAL' -and $_.label -eq $package.transmittals[0] }
Call POST "/api/projects/$($project.id)/transmittals/$($job.transmittalId)/recipients/$($job.recipientId)/dispatch" @{
    channel = 'Client portal'; reference = 'NWU-SUB-0043'
} $control | Out-Null
Write-Host "Document Control recorded it went by the client portal"
$package = Call POST "$pk/accept" @{} $approver
Write-Host "$($package.state) by $($package.acceptedBy)"

Step 'The transmittal log'
foreach ($t in (Call GET "/api/projects/$($project.id)/transmittals" $null $control)) {
    Write-Host ('{0,-24} {1,-12} to {2}' -f $t.number, $t.reason, $t.to)
}

Step 'The schedule: a controlled document; once released, its export becomes activities'
$p = "/api/projects/$($project.id)"
$sch = Call POST "$p/documents" @{
    title = "Construction programme $(Get-Date -Format 'HHmmss')"; deliverableType = 'ENG'; docType = 'SCH'; discipline = 'PM'; subproject = '00'
}
Call PUT "$p/schedule" @{ documentId = $sch.id } $control | Out-Null
function Day($n) { (Get-Date).AddDays($n).ToString('dd-MMM-yy', [Globalization.CultureInfo]::InvariantCulture) }
$csv = "Activity ID,Activity Name,Start,Finish,Responsible,Departments`n" +
    "A100,Pour inlet base slab,$(Day 5),$(Day 8),Site team,Civil`n" +
    "A200,Install switchgear,$(Day 60),$(Day 70),Electrical,Electrical`n" +
    "A300,Backfill and compact,$(Day 30),$(Day 40),Site team,Civil`n"
$schFiles = @(
    (Upload "$p/documents/$($sch.id)/uploads" 'Programme.pdf' (New-Pdf 'Construction programme')),
    (Upload "$p/documents/$($sch.id)/uploads" 'Programme.csv' ([Text.Encoding]::UTF8.GetBytes($csv)) $session 'text/csv'))
$schRevision = Call POST "$p/documents/$($sch.id)/revisions" @{ fileIds = $schFiles }
do {
    Start-Sleep -Seconds 1
    $current = (Call GET "$p/documents/$($sch.id)").revisions[0]
} while ($current.filesState -eq 'PROCESSING')
$schReview = Call POST "$p/revisions/$($schRevision.id)/reviews" @{}
Call POST "$p/reviews/$($schReview.id)/answer" @{} | Out-Null
Call POST "$p/reviews/$($schReview.id)/answer" @{ verdict = 'C1'; status = 'IFC' } $approver | Out-Null
Call POST "$p/reviews/$($schReview.id)/release" @{} $control | Out-Null
do {
    Start-Sleep -Seconds 1
    $read = (Call GET "$p/schedule" $null $control).imports | Where-Object { $_.revisionId -eq $schRevision.id }
} while (-not $read)
Write-Host "$($sch.number) rev $($read.revisionValue) read: $($read.added) new, $($read.moved) moved, $($read.removed) removed ($($read.status))"

Step 'What the activities need, and what for'
$activities = Call GET "$p/activities"
$a100 = ($activities | Where-Object { $_.code -eq 'A100' }).id
$a200 = ($activities | Where-Object { $_.code -eq 'A200' }).id
Call POST "$p/activities/$a100/needs" @{ documentId = $doc.id; purpose = 'EXECUTION' } | Out-Null
$layout = Call POST "$p/documents" @{
    title = "Switchroom layout $(Get-Date -Format 'HHmmss')"; deliverableType = 'ENG'; docType = 'DWG'; discipline = 'EL'; subproject = '20'
}
$need = Call POST "$p/activities/$a200/needs" @{ documentId = $layout.id; purpose = 'INFORMATION'; department = 'EL' }
Call POST "$p/activities/$a200/needs/$(($need.needs | Where-Object { $_.documentId -eq $layout.id }).id)/waive" @{ note = 'Received by email; will be uploaded later.' } $control | Out-Null
foreach ($a in (Call GET "$p/activities")) {
    Write-Host ('{0} {1,-24} starts {2}  {3,-18} {4}/{5} met, {6} waived' -f $a.code, $a.name, $a.start, $a.readiness, $a.met, $a.needs, $a.waived)
}

Step 'Document Control runs the checks over the register'
$run = Call POST "/api/projects/$($project.id)/checks/run" @{} $control
do {
    Start-Sleep -Seconds 1
    $run = Call GET "/api/projects/$($project.id)/checks/runs/$($run.id)" $null $control
} while ($run.status -in 'QUEUED', 'RUNNING')
Write-Host "Integrity $($run.integrity)%, coverage $($run.coverage)%, $($run.failed) check(s) failing, $($run.openCritical) Critical open"
$catalog = Call GET "/api/projects/$($project.id)/checks" $null $control
foreach ($c in $catalog.checks | Where-Object { $_.result -eq 'FAIL' }) {
    Write-Host ("  {0} {1,-8} {2} ({3})" -f $c.id, $c.severity, $c.condition, $c.failing)
}

Step 'The register'
foreach ($d in (Call GET "/api/projects/$($project.id)/documents").items) {
    Write-Host ('{0,-24} rev {1,-2} {2,-15} {3}' -f $d.number, $d.latestRevision, $d.latestRevisionState, $d.title)
}
