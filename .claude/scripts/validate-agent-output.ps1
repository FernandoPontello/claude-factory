# validate-agent-output — a CLI não impõe schema de output de sub-agent; a factory valida
# (README §15). O estágio roda este script sobre a saída estruturada do agent e falha
# ruidosamente se ela não parsear ou não tiver as chaves exigidas.
#
# Uso:  validate-agent-output.ps1 -File saida.json -Required "epics"     (caminho ROBUSTO)
#       <saída> | validate-agent-output.ps1 -Required "completed,failed,patch"
# Sai 0 se válido; 1 (ruidoso) se não. NUNCA pendura: sem -File, stdin não-redirecionado
# falha na hora, e stdin que não fecha em 10s falha por timeout — shell órfão é defeito.

param(
    [string]$File,
    [Parameter(Mandatory = $true)][string]$Required
)

$raw = if ($File) {
    Get-Content $File -Raw -ErrorAction SilentlyContinue
} else {
    if (-not [Console]::IsInputRedirected) {
        [Console]::Error.WriteLine("validate-agent-output: sem -File e sem stdin redirecionado — nada a validar. Use: validate-agent-output.ps1 -File <saida.json> -Required `"...`" (ou pipe a saída).")
        exit 1
    }
    # stdin redirecionado mas que nunca fecha (pipe aberto) penduraria o ReadToEnd — teto de 10s.
    # NUNCA via [Console]::In: é SyncTextReader e os métodos *Async executam SÍNCRONOS (bloqueiam
    # na chamada). O stream cru de OpenStandardInput tem async de verdade.
    $reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
    $readTask = $reader.ReadToEndAsync()
    if (-not $readTask.Wait(10000)) {
        [Console]::Error.WriteLine("validate-agent-output: stdin não fechou em 10s — pipe pendurado. Grave a saída do agent em arquivo e use -File (caminho robusto).")
        exit 1
    }
    $readTask.Result
}
if (-not $raw -or -not $raw.Trim()) {
    [Console]::Error.WriteLine("validate-agent-output: saída VAZIA — o agent não devolveu nada. Falhando ruidosamente (§15).")
    exit 1
}

# tolera cerca de markdown ```json ... ```
$clean = $raw.Trim()
if ($clean -match '(?ms)^```(?:json)?\s*\r?\n(.*?)\r?\n```\s*$') { $clean = $Matches[1] }

try { $obj = $clean | ConvertFrom-Json } catch {
    [Console]::Error.WriteLine("validate-agent-output: saída não é JSON válido. Primeiros 200 chars:`n$($clean.Substring(0, [Math]::Min(200, $clean.Length)))")
    exit 1
}

$missing = @()
foreach ($key in ($Required -split ',')) {
    $k = $key.Trim()
    if (-not $k) { continue }
    if (-not ($obj.PSObject.Properties.Name -contains $k)) { $missing += $k }
}

if ($missing.Count -gt 0) {
    [Console]::Error.WriteLine("validate-agent-output: chaves obrigatórias ausentes: $($missing -join ', '). O estágio deve re-instruir o agent, não prosseguir com saída parcial (§15).")
    exit 1
}
exit 0
