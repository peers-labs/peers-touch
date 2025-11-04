# Trae Agent MCP Integration Test Script
# This script simulates Trae Agent interaction with MCP service

Write-Host "=== Trae Agent MCP Integration Test ===" -ForegroundColor Green

# Configuration
$MCP_PORT = 18888
$MCP_BASE_URL = "http://localhost:$MCP_PORT"

# Test function
function Test-Endpoint {
    param(
        [string]$endpoint,
        [string]$method = "GET",
        [string]$body = $null,
        [string]$description
    )
    
    Write-Host "`nTesting: $description" -ForegroundColor Yellow
    Write-Host "Endpoint: $endpoint" -ForegroundColor Gray
    
    try {
        $headers = @{
            "Content-Type" = "application/json"
        }
        
        $params = @{
            Uri = "$MCP_BASE_URL$endpoint"
            Method = $method
            Headers = $headers
        }
        
        if ($body) {
            $params.Body = $body
        }
        
        $response = Invoke-WebRequest @params
        
        Write-Host "Status: $($response.StatusCode)" -ForegroundColor Green
        Write-Host "Response:" -ForegroundColor Gray
        Write-Host $response.Content -ForegroundColor White
        
        return $true
    }
    catch {
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# Run tests
$tests = @(
    @{
        endpoint = "/health"
        method = "GET"
        description = "Health check"
    },
    @{
        endpoint = "/mcp/initialize"
        method = "POST"
        body = '{"protocolVersion":"2024-11-05","capabilities":{}}'
        description = "MCP initialization"
    },
    @{
        endpoint = "/mcp/list-tools"
        method = "POST"
        body = '{}'
        description = "List available tools"
    },
    @{
        endpoint = "/mcp/list-prompts"
        method = "POST"
        body = '{}'
        description = "List available prompts"
    }
)

$passed = 0
$total = $tests.Count

foreach ($test in $tests) {
    if (Test-Endpoint @test) {
        $passed++
    }
}

Write-Host "`n=== Test Results ===" -ForegroundColor Cyan
Write-Host "Passed: $passed/$total" -ForegroundColor $(if ($passed -eq $total) { "Green" } else { "Red" })

if ($passed -eq $total) {
    Write-Host "All tests passed! Trae Agent can successfully connect to MCP service." -ForegroundColor Green
    Write-Host "`nConfiguration suggestions:" -ForegroundColor Yellow
    Write-Host "1. Use port $MCP_PORT in Trae configuration" -ForegroundColor White
    Write-Host "2. Ensure mcp-dev.exe path is correct" -ForegroundColor White
    Write-Host "3. Restart Trae to apply configuration changes" -ForegroundColor White
} else {
    Write-Host "Some tests failed, please check MCP service status and configuration." -ForegroundColor Red
}