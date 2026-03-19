package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

const (
	baseURL   = "http://localhost:18080"
	username  = "testuser" // Adjust this to the user logged in or expected
	outboxURL = baseURL + "/activitypub/" + username + "/outbox"
)

func main() {
	// 1. Construct the Note object
	note := map[string]interface{}{
		"type":    "Note",
		"content": "<p>Hello from test_post.go! This is a test post to verify the 'Me' tab.</p>",
		"published": time.Now().UTC().Format(time.RFC3339),
		"attributedTo": baseURL + "/activitypub/" + username,
		"to": []string{"https://www.w3.org/ns/activitystreams#Public"},
	}

	// 2. Construct the Create activity
	activity := map[string]interface{}{
		"@context": "https://www.w3.org/ns/activitystreams",
		"type":     "Create",
		"actor":    baseURL + "/activitypub/" + username,
		"object":   note,
		"published": time.Now().UTC().Format(time.RFC3339),
		"to": []string{"https://www.w3.org/ns/activitystreams#Public"},
	}

	jsonData, err := json.Marshal(activity)
	if err != nil {
		panic(err)
	}

	fmt.Printf("Sending activity to %s\n", outboxURL)
	fmt.Println(string(jsonData))

	// 3. Send POST request
	req, err := http.NewRequest("POST", outboxURL, bytes.NewBuffer(jsonData))
	if err != nil {
		panic(err)
	}
	req.Header.Set("Content-Type", "application/activity+json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()

	fmt.Printf("Response Status: %s\n", resp.Status)
    
    // Read response body if needed
    // body, _ := io.ReadAll(resp.Body)
    // fmt.Println(string(body))
}
