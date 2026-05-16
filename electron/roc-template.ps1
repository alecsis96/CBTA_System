param(
  [Parameter(Mandatory = $true)] [string]$TemplatePath,
  [Parameter(Mandatory = $true)] [string]$OutputPath,
  [Parameter(Mandatory = $true)] [string]$PayloadBase64
)

$json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($PayloadBase64))
$payload = $json | ConvertFrom-Json

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

Copy-Item -LiteralPath $TemplatePath -Destination $OutputPath -Force

$workbook = $excel.Workbooks.Open($OutputPath)
$sheet = $workbook.Worksheets.Item(1)

# Header and identity block
$sheet.Range('N4').Value2 = $payload.rocNumber
$sheet.Range('J7').Value2 = $payload.printDate
$sheet.Range('C10').Value2 = $payload.fullName
$sheet.Range('K11').Value2 = $payload.identifier
$sheet.Range('C14').Value2 = $payload.address
$sheet.Range('L14').Value2 = $payload.grade
$sheet.Range('N14').Value2 = $payload.group
$sheet.Range('O14').Value2 = $payload.shift

# Amount block
$sheet.Range('E17').Value2 = [double]$payload.totalAmount
$sheet.Range('F17').Value2 = '(' + $payload.amountInWords + ')'

# Detail rows
$detailRows = @(20, 21, 22)
foreach ($row in $detailRows) {
  $sheet.Range("D$row:N$row").ClearContents()
}

for ($i = 0; $i -lt $payload.lines.Count -and $i -lt $detailRows.Count; $i++) {
  $row = $detailRows[$i]
  $line = $payload.lines[$i]
  $sheet.Range("D$row").Value2 = 1
  $sheet.Range("E$row").Value2 = $line.code
  $sheet.Range("F$row").Value2 = $line.name
  $sheet.Range("J$row").Value2 = [double]$line.amount
  $sheet.Range("N$row").Value2 = [double]$line.amount
}

$sheet.Range('N23').Value2 = [double]$payload.totalAmount

$workbook.Save()
$workbook.Close($true)
$excel.Quit()

[System.Runtime.InteropServices.Marshal]::ReleaseComObject($sheet) | Out-Null
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) | Out-Null
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
