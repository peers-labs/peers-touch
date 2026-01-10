#!/usr/bin/env python3

import requests
import json
import sys

BASE_URL = "http://localhost:18080"

def print_step(step, message):
    print(f"\n[{step}] {message}")

def print_json(data):
    print(json.dumps(data, indent=2, ensure_ascii=False))

def main():
    print("=== Testing Profile Upload Flow ===\n")
    
    # Step 1: Login
    print_step(1, "Logging in...")
    login_response = requests.post(
        f"{BASE_URL}/activitypub/login",
        json={
            "email": "desktop-1@example.com",
            "password": "preset-desktop-1"
        }
    )
    
    print("Login Response:")
    login_data = login_response.json()
    print_json(login_data)
    
    # Extract token
    token = None
    if 'data' in login_data and 'tokens' in login_data['data']:
        token = login_data['data']['tokens'].get('access_token') or login_data['data']['tokens'].get('token')
    elif 'tokens' in login_data:
        token = login_data['tokens'].get('access_token') or login_data['tokens'].get('token')
    
    if not token:
        print("❌ Failed to get token from login response")
        sys.exit(1)
    
    print(f"✅ Token obtained: {token[:20]}...")
    
    # Step 2: Test OSS upload
    print_step(2, "Testing OSS upload...")
    
    # Create a test file
    test_content = b"test content for avatar upload"
    files = {'file': ('test_avatar.txt', test_content, 'text/plain')}
    headers = {'Authorization': f'Bearer {token}'}
    
    upload_response = requests.post(
        f"{BASE_URL}/sub-oss/upload",
        files=files,
        headers=headers
    )
    
    print(f"Upload Status Code: {upload_response.status_code}")
    print("Upload Response:")
    
    if upload_response.status_code == 200:
        upload_data = upload_response.json()
        print_json(upload_data)
        
        file_key = upload_data.get('key')
        file_url = upload_data.get('url')
        
        if not file_key:
            print("❌ Failed to upload file - no key in response")
            sys.exit(1)
        
        print(f"✅ File uploaded: {file_url}")
    else:
        print(f"❌ Upload failed with status {upload_response.status_code}")
        print(upload_response.text)
        sys.exit(1)
    
    # Step 3: Get current profile
    print_step(3, "Getting current profile...")
    profile_response = requests.get(
        f"{BASE_URL}/activitypub/actor/profile",
        headers=headers
    )
    
    print("Current Profile:")
    profile_data = profile_response.json()
    print_json(profile_data)
    
    handle = profile_data.get('handle') or profile_data.get('username')
    
    if not handle:
        print("❌ Failed to get profile handle")
        sys.exit(1)
    
    print(f"✅ Profile handle: {handle}")
    
    # Step 4: Update profile with avatar
    print_step(4, "Updating profile with avatar...")
    update_response = requests.post(
        f"{BASE_URL}/activitypub/profile",
        json={"avatar": file_url},
        headers=headers
    )
    
    print(f"Update Status Code: {update_response.status_code}")
    print("Update Response:")
    print(update_response.text)
    
    if update_response.status_code not in [200, 204]:
        print(f"❌ Update failed with status {update_response.status_code}")
        sys.exit(1)
    
    # Step 5: Verify profile was updated
    print_step(5, "Verifying profile update...")
    verify_response = requests.get(
        f"{BASE_URL}/activitypub/actor/profile",
        headers=headers
    )
    
    print("Updated Profile:")
    verify_data = verify_response.json()
    print_json(verify_data)
    
    updated_avatar = verify_data.get('avatar_url') or verify_data.get('avatar')
    
    if updated_avatar == file_url:
        print("\n✅ Avatar successfully updated!")
    else:
        print(f"\n❌ Avatar not updated. Expected: {file_url}, Got: {updated_avatar}")
        sys.exit(1)
    
    print("\n=== All tests passed! ===")

if __name__ == "__main__":
    main()
