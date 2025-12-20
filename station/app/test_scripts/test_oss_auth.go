package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/auth"
)

const (
	baseURL      = "http://localhost:18080"
	uploadURL    = baseURL + "/sub-oss/upload"
	secret       = "secret123"
	prevSecret   = "oldsecret456"
)

func main() {
	// Initialize auth config for token generation
	auth.Init(auth.Config{Secret: secret, PreviousSecret: prevSecret, AccessTTL: time.Hour})

	fmt.Println("=== Testing OSS Auth ===")

	// 1. Test Upload without Token (Should Fail)
	fmt.Println("\n[1] Testing Upload without Token...")
	testUpload(nil, http.StatusUnauthorized)

	// 2. Test Upload with Primary Token (Should Succeed)
	fmt.Println("\n[2] Testing Upload with Primary Token...")
	token1 := generateToken(secret)
	testUpload(&token1, http.StatusOK)

	// 3. Test Upload with Previous Token (Should Succeed)
	fmt.Println("\n[3] Testing Upload with Previous Token...")
	token2 := generateToken(prevSecret)
	testUpload(&token2, http.StatusOK)

	// 4. Test Upload with Invalid Token (Should Fail)
	fmt.Println("\n[4] Testing Upload with Invalid Token...")
	invalidToken := "invalid.token.here"
	testUpload(&invalidToken, http.StatusUnauthorized)
}

func generateToken(key string) string {
	provider := auth.NewJWTProvider(key, time.Hour)
	_, token, err := provider.Authenticate(context.Background(), auth.Credentials{SubjectID: "test-user", Attributes: map[string]string{}})
	if err != nil {
		panic(err)
	}
	return token.Value
}

func testUpload(token *string, expectedStatus int) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", "test.txt")
	if err != nil {
		panic(err)
	}
	_, err = io.Copy(part, bytes.NewBufferString("Hello OSS Auth!"))
	if err != nil {
		panic(err)
	}
	writer.Close()

	req, err := http.NewRequest("POST", uploadURL, body)
	if err != nil {
		panic(err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if token != nil {
		req.Header.Set("Authorization", "Bearer "+*token)
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("Request failed: %v\n", err)
		return
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	fmt.Printf("Status: %s (Expected: %d)\n", resp.Status, expectedStatus)
	fmt.Printf("Body: %s\n", string(bodyBytes))

	if resp.StatusCode != expectedStatus {
		fmt.Printf("❌ FAILED: Expected status %d, got %d\n", expectedStatus, resp.StatusCode)
	} else {
		fmt.Printf("✅ PASSED\n")
	}
}
