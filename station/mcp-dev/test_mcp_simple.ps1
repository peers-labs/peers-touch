# MCP Service Test Script
# This script demonstrates the MCP service functionality

Write-Host "Testing MCP Development Service..." -ForegroundColor Green

# Test 1: Health Check
Write-Host "`n1. Testing Health Endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8888/health" -Method GET
    Write-Host "✓ Health check passed: $($response.Content)" -ForegroundColor Green
} catch {
    Write-Host "✗ Health check failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 2: Initialize MCP
Write-Host "`n2. Testing MCP Initialize..." -ForegroundColor Yellow
try {
    $body = '{"protocolVersion":"2024-11-05","capabilities":{}}'
    $response = Invoke-WebRequest -Uri "http://localhost:8888/mcp/initialize" -Method POST -Headers @{"Content-Type"="application/json"} -Body $body
    Write-Host "✓ MCP Initialize passed: $($response.Content)" -ForegroundColor Green
} catch {
    Write-Host "✗ MCP Initialize failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 3: List Tools
Write-Host "`n3. Testing List Tools..." -ForegroundColor Yellow
try {
    $body = '{}'
    $response = Invoke-WebRequest -Uri "http://localhost:8888/mcp/list-tools" -Method POST -Headers @{"Content-Type"="application/json"} -Body $body
    $content = $response.Content
    if ($content.Length -gt 200) {
        $content = $content.Substring(0, 200) + "..."
    }
    Write-Host "✓ List Tools passed: $content" -ForegroundColor Green
} catch {
    Write-Host "✗ List Tools failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 4: List Prompts
Write-Host "`n4. Testing List Prompts..." -ForegroundColor Yellow
try {
    $body = '{}'
    $response = Invoke-WebRequest -Uri "http://localhost:8888/mcp/list-prompts" -Method POST -Headers @{"Content-Type"="application/json"} -Body $body
    Write-Host "✓ List Prompts passed: $($response.Content)" -ForegroundColor Green
} catch {
    Write-Host "✗ List Prompts failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`nMCP Service Testing Complete!" -ForegroundColor Green
Write-Host "`nThe MCP Development Service is running with the following features:" -ForegroundColor Cyan
Write-Host "- Health monitoring endpoint" -ForegroundColor White
Write-Host "- MCP protocol support (initialize, tools, prompts)" -ForegroundColor White
Write-Host "- Code generation capabilities" -ForegroundColor White
Write-Host "- Compliance checking" -ForegroundColor White
Write-Host "- SQLite database for persistent storage" -ForegroundColor White