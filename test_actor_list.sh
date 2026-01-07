#!/bin/bash

echo "Testing /activitypub/list endpoint..."
echo "========================================"
curl -v http://localhost:18080/activitypub/list 2>&1 | grep -E "(< HTTP|error|email|username)"
echo ""
echo "========================================"
echo "If you see 'Valid JWT token required', the endpoint still requires authentication."
echo "If you see user data with email fields, the endpoint is working correctly."
