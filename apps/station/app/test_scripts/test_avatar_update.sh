#!/bin/bash

set -e

BASE_URL="http://localhost:18080"

echo "=== Testing Avatar Update Flow ==="
echo ""

# Step 1: Login
echo "[1] Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/activitypub/login" \
  -H "Content-Type: application/json" \
  -d '{"email": "desktop-1@example.com", "password": "preset-desktop-1"}')

TOKEN=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['data']['tokens']['access_token'])")

if [ -z "$TOKEN" ]; then
  echo "❌ Failed to get token"
  exit 1
fi

echo "✅ Token obtained"
echo ""

# Step 2: Upload avatar
echo "[2] Uploading avatar..."
echo "test avatar content" > /tmp/test_avatar.txt

UPLOAD_RESPONSE=$(curl -s -X POST "$BASE_URL/sub-oss/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/test_avatar.txt")

FILE_URL=$(echo "$UPLOAD_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('url', ''))")

if [ -z "$FILE_URL" ]; then
  echo "❌ Failed to upload file"
  echo "$UPLOAD_RESPONSE"
  exit 1
fi

echo "✅ File uploaded: $FILE_URL"
echo ""

# Step 3: Update profile with avatar
echo "[3] Updating profile with avatar..."
UPDATE_RESPONSE=$(curl -s -X POST "$BASE_URL/activitypub/profile" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"avatar\": \"$FILE_URL\"}")

echo "Update response: $UPDATE_RESPONSE"
echo ""

# Step 4: Verify avatar was updated
echo "[4] Verifying avatar update..."
PROFILE_RESPONSE=$(curl -s -X GET "$BASE_URL/activitypub/profile" \
  -H "Authorization: Bearer $TOKEN")

AVATAR_URL=$(echo "$PROFILE_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('data', {}).get('avatar', ''))")

echo "Current avatar: $AVATAR_URL"

if [ "$AVATAR_URL" = "$FILE_URL" ]; then
  echo "✅ Avatar successfully updated!"
else
  echo "❌ Avatar not updated. Expected: $FILE_URL, Got: $AVATAR_URL"
  exit 1
fi

echo ""
echo "=== All tests passed! ==="
