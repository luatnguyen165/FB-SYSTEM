# Kill process on port 5000
$process = netstat -ano | Select-String ":5000 " | Select-String "LISTEN"
if ($process) {
    $parts = $process -split '\s+'
    $pid = $parts[-1]
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    Write-Host "Killed process $pid on port 5000"
} else {
    Write-Host "No process found on port 5000"
}