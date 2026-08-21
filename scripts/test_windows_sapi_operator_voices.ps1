$outputDir = Join-Path (Split-Path -Parent $PSScriptRoot) "video\sapi_voice_tests"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$text = ('{"text":"\\u6211\\u662f\\u4ea7\\u7ebf\\u64cd\\u4f5c\\u5458\\u3002\\u5f53\\u524d\\u4eff\\u771f\\u6b63\\u5e38\\uff0c\\u7269\\u6d41\\u8def\\u5f84\\u7545\\u901a\\uff0c\\u51c6\\u5907\\u5f00\\u59cb\\u4e0b\\u4e00\\u8f6e\\u8fd0\\u884c\\u3002"}' | ConvertFrom-Json).text
$sp = New-Object -ComObject SAPI.SpVoice
$stream = New-Object -ComObject SAPI.SpFileStream
foreach ($name in @('Huihui', 'Kangkang', 'Yaoyao')) {
    $voice = $sp.GetVoices() | Where-Object { $_.GetDescription() -like ("*" + $name + "*") } | Select-Object -First 1
    if (-not $voice) { Write-Output "missing $name"; continue }
    $sp.Voice = $voice
    $target = Join-Path $outputDir ("operator_" + $name + ".wav")
    $stream.Open($target, 3, $false)
    $sp.AudioOutputStream = $stream
    $sp.Speak($text)
    $stream.Close()
    Write-Output ($name + " -> " + $target)
}
