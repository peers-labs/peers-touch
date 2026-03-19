#!/bin/bash

BASE_URL="http://localhost:18080"

echo "=== Testing Profile Upload Flow ==="
echo ""

# Step 1: Login to get token
echo "[1] Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/activitypub/actor/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "desktop-1@example.com",
    "password": "password123"
  }')

echo "Login Response:"
echo "$LOGIN_RESPONSE" | jq '.'
echo ""

# Extract token
TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.tokens.access_token // .tokens.token // empty')

if [ -z "$TOKEN" ]; then
  echo "❌ Failed to get token from login response"
  exit 1
fi

echo "✅ Token obtained: ${TOKEN:0:20}..."
echo ""

# Step 2: Test OSS upload
echo "[2] Testing OSS upload..."
echo "test content" > /tmp/test_upload.txt

UPLOAD_RESPONSE=$(curl -s -X POST "$BASE_URL/sub-oss/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/test_upload.txt")

echo "Upload Response:"
echo "$UPLOAD_RESPONSE" | jq '.'
echo ""

# Extract uploaded file URL
FILE_KEY=$(echo "$UPLOAD_RESPONSE" | jq -r '.key // empty')
FILE_URL=$(echo "$UPLOAD_RESPONSE" | jq -r '.url // empty')

if [ -z "$FILE_KEY" ]; then
  echo "❌ Failed to upload file"
  exit 1
fi

echo "✅ File uploaded: $FILE_URL"
echo ""

# Step 3: Get current profile
echo "[3] Getting current profile..."
PROFILE_RESPONSE=$(curl -s -X GET "$BASE_URL/activitypub/actor/profile" \
  -H "Authorization: Bearer $TOKEN")

echo "Current Profile:"
echo "$PROFILE_RESPONSE" | jq '.'
echo ""

HANDLE=$(echo "$PROFILE_RESPONSE" | jq -r '.handle // .username // empty')

if [ -z "$HANDLE" ]; then
  echo "❌ Failed to get profile handle"
  exit 1
fi

echo "✅ Profile handle: $HANDLE"
echo ""

# Step 4: Update profile with avatar
echo "[4] Updating profile with avatar..."
UPDATE_RESPONSE=$(curl -s -X PATCH "$BASE_URL/activitypub/$HANDLE/profile" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"avatar\": \"$FILE_URL\"
  }")

echo "Update Response:"
echo "$UPDATE_RESPONSE"
echo ""

# Step 5: Verify profile was updated
echo "[5] Verifying profile update..."
VERIFY_RESPONSE=$(curl -s -X GET "$BASE_URL/activitypub/actor/profile" \
  -H "Authorization: Bearer $TOKEN")

echo "Updated Profile:"
echo "$VERIFY_RESPONSE" | jq '.'
echo ""

UPDATED_AVATAR=$(echo "$VERIFY_RESPONSE" | jq -r '.avatar_url // .avatar // empty')

if [ "$UPDATED_AVATAR" = "$FILE_URL" ]; then
  echo "✅ Avatar successfully updated!"
else
  echo "❌ Avatar not updated. Expected: $FILE_URL, Got: $UPDATED_AVATAR"
  exit 1
fi

echo ""
echo "=== All tests passed! ==="
