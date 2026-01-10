#!/bin/bash

BASE_URL="http://localhost:18080"

echo "=== Testing ActivityPub Create Activity ==="
echo ""

# Step 1: Login
echo "1. Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/actor/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "desktop-1@example.com",
    "password": "password123"
  }')

echo "Login Response:"
echo "$LOGIN_RESPONSE" | jq '.'
echo ""

# Extract token
TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.data.tokens.token')
if [ "$TOKEN" == "null" ] || [ -z "$TOKEN" ]; then
  echo "❌ Failed to get token"
  exit 1
fi

echo "✅ Token obtained: ${TOKEN:0:20}..."
echo ""

# Step 2: Create Activity
echo "2. Creating activity..."
ACTIVITY_RESPONSE=$(curl -s -X POST "$BASE_URL/activitypub/desktop-1/outbox" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "@context": "https://www.w3.org/ns/activitystreams",
    "type": "Create",
    "actor": "http://localhost:18080/activitypub/desktop-1/actor",
    "object": {
      "type": "Note",
      "content": "Hello from test script! 🎉",
      "attributedTo": "http://localhost:18080/activitypub/desktop-1/actor",
      "to": ["https://www.w3.org/ns/activitystreams#Public"],
      "cc": ["http://localhost:18080/activitypub/desktop-1/followers"]
    },
    "to": ["https://www.w3.org/ns/activitystreams#Public"],
    "cc": ["http://localhost:18080/activitypub/desktop-1/followers"]
  }')

echo "Activity Response:"
echo "$ACTIVITY_RESPONSE" | jq '.'
echo ""

# Check if successful
if echo "$ACTIVITY_RESPONSE" | jq -e '.code == 200' > /dev/null; then
  echo "✅ Activity created successfully!"
else
  echo "❌ Failed to create activity"
  exit 1
fi
