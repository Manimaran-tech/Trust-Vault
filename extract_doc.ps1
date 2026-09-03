$word = New-Object -ComObject Word.Application
$word.Visible = $false
$doc = $word.Documents.Open('c:\TrustVault\TrustVault.docx')
$text = $doc.Content.Text
$text | Out-File -FilePath 'c:\TrustVault\TrustVault_extracted.txt' -Encoding UTF8
$doc.Close()
$word.Quit()
Write-Output 'Extraction complete'
