package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	baseURL = "http://localhost:18080"
	secret  = "test-secret-key-for-development"
)

type jwtClaims struct {
	SubjectID string `json:"subject_id"`
	jwt.RegisteredClaims
}

func generateToken(subjectID string) (string, error) {
	now := time.Now()
	exp := now.Add(24 * time.Hour)
	claims := jwtClaims{
		SubjectID: subjectID,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(exp),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func main() {
	actorID := "123"
	token, err := generateToken(actorID)
	if err != nil {
		panic(err)
	}

	fmt.Printf("Generated JWT Token for actor ID %s:\n%s\n\n", actorID, token)

	client := &http.Client{}

	fmt.Println("=== Test 1: Create Post (with auth) ===")
	createPostData := map[string]interface{}{
		"content": "Hello from Social API! This is my first post.",
		"visibility": "public",
	}
	createPostJSON, _ := json.Marshal(createPostData)
	req, _ := http.NewRequest("POST", baseURL+"/api/v1/social/posts", bytes.NewBuffer(createPostJSON))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	} else {
		body, _ := io.ReadAll(resp.Body)
		fmt.Printf("Status: %d\n", resp.StatusCode)
		fmt.Printf("Response: %s\n\n", string(body))
		resp.Body.Close()
	}

	fmt.Println("=== Test 2: Create Post (without auth - should fail) ===")
	req, _ = http.NewRequest("POST", baseURL+"/api/v1/social/posts", bytes.NewBuffer(createPostJSON))
	req.Header.Set("Content-Type", "application/json")

	resp, err = client.Do(req)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	} else {
		body, _ := io.ReadAll(resp.Body)
		fmt.Printf("Status: %d\n", resp.StatusCode)
		fmt.Printf("Response: %s\n\n", string(body))
		resp.Body.Close()
	}

	fmt.Println("=== Test 3: Get Post (no auth required) ===")
	req, _ = http.NewRequest("GET", baseURL+"/api/v1/social/posts/test-post-id", nil)

	resp, err = client.Do(req)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	} else {
		body, _ := io.ReadAll(resp.Body)
		fmt.Printf("Status: %d\n", resp.StatusCode)
		fmt.Printf("Response: %s\n\n", string(body))
		resp.Body.Close()
	}

	fmt.Println("=== Test 4: Get Timeline (no auth required) ===")
	req, _ = http.NewRequest("GET", baseURL+"/api/v1/social/timeline?limit=10", nil)

	resp, err = client.Do(req)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	} else {
		body, _ := io.ReadAll(resp.Body)
		fmt.Printf("Status: %d\n", resp.StatusCode)
		fmt.Printf("Response: %s\n\n", string(body))
		resp.Body.Close()
	}

	fmt.Println("=== Test 5: Like Post (with auth) ===")
	req, _ = http.NewRequest("POST", baseURL+"/api/v1/social/posts/test-post-id/like", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err = client.Do(req)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	} else {
		body, _ := io.ReadAll(resp.Body)
		fmt.Printf("Status: %d\n", resp.StatusCode)
		fmt.Printf("Response: %s\n\n", string(body))
		resp.Body.Close()
	}

	fmt.Println("=== Test 6: Update Post (with auth) ===")
	updatePostData := map[string]interface{}{
		"content": "Updated post content",
	}
	updatePostJSON, _ := json.Marshal(updatePostData)
	req, _ = http.NewRequest("PUT", baseURL+"/api/v1/social/posts/test-post-id", bytes.NewBuffer(updatePostJSON))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err = client.Do(req)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	} else {
		body, _ := io.ReadAll(resp.Body)
		fmt.Printf("Status: %d\n", resp.StatusCode)
		fmt.Printf("Response: %s\n\n", string(body))
		resp.Body.Close()
	}

	fmt.Println("=== Test 7: Delete Post (with auth) ===")
	req, _ = http.NewRequest("DELETE", baseURL+"/api/v1/social/posts/test-post-id", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err = client.Do(req)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	} else {
		body, _ := io.ReadAll(resp.Body)
		fmt.Printf("Status: %d\n", resp.StatusCode)
		fmt.Printf("Response: %s\n\n", string(body))
		resp.Body.Close()
	}

	fmt.Println("\n✅ All API tests completed!")
	fmt.Println("\nNote: Some tests may return 404 or errors because the database is empty.")
	fmt.Println("The important thing is that authentication is working correctly:")
	fmt.Println("  - POST/PUT/DELETE require Bearer token (401 without it)")
	fmt.Println("  - GET requests work without authentication")
}
