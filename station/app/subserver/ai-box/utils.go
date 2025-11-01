package aibox

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

// generateID generates a unique ID
func generateID() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// generateConversationTitle generates a title from the first message
func generateConversationTitle(message string) string {
	// Take first 50 characters and clean up
	title := strings.TrimSpace(message)
	if len(title) > 50 {
		title = title[:47] + "..."
	}

	// Remove special characters and normalize
	title = strings.ReplaceAll(title, "\n", " ")
	title = strings.ReplaceAll(title, "\r", " ")
	title = strings.ReplaceAll(title, "\t", " ")

	// Collapse multiple spaces
	for strings.Contains(title, "  ") {
		title = strings.ReplaceAll(title, "  ", " ")
	}

	title = strings.TrimSpace(title)
	if title == "" {
		title = "New Conversation"
	}

	return title
}

// truncateString truncates a string to the specified length
func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-3] + "..."
}

// parseTime parses time string with multiple formats
func parseTime(timeStr string) (time.Time, error) {
	formats := []string{
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02",
		time.RFC3339Nano,
	}

	for _, format := range formats {
		t, err := time.Parse(format, timeStr)
		if err == nil {
			return t, nil
		}
	}

	return time.Time{}, fmt.Errorf("unable to parse time: %s", timeStr)
}

// contains checks if a string slice contains a string
func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

// removeDuplicates removes duplicate strings from a slice
func removeDuplicates(slice []string) []string {
	seen := make(map[string]bool)
	result := []string{}

	for _, item := range slice {
		if !seen[item] {
			seen[item] = true
			result = append(result, item)
		}
	}

	return result
}

// clamp clamps a value between min and max
func clamp(value, min, max float32) float32 {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

// isValidModel checks if a model string is valid
func isValidModel(model string) bool {
	validModels := []string{
		"gpt-4", "gpt-4-turbo", "gpt-3.5-turbo",
		"claude-3-opus", "claude-3-sonnet", "claude-3-haiku",
		"llama2", "llama3", "mistral", "gemini-pro",
		"text-davinci-003", "text-curie-001", "text-babbage-001",
	}

	return contains(validModels, model)
}

// isValidProvider checks if a provider string is valid
func isValidProvider(provider string) bool {
	validProviders := []string{
		"openai", "anthropic", "google", "local", "huggingface",
		"cohere", "ai21", "azure", "aws-bedrock",
	}

	return contains(validProviders, provider)
}

// sanitizeFileName sanitizes a file name for safe storage
func sanitizeFileName(fileName string) string {
	// Remove or replace problematic characters
	replacements := map[string]string{
		"/":  "_",
		"\\": "_",
		":":  "_",
		"*":  "_",
		"?":  "_",
		"\"": "_",
		"<":  "_",
		">":  "_",
		"|":  "_",
		" ":  "_",
		"\t": "_",
		"\n": "_",
	}

	result := fileName
	for old, new := range replacements {
		result = strings.ReplaceAll(result, old, new)
	}

	// Remove multiple consecutive underscores
	for strings.Contains(result, "__") {
		result = strings.ReplaceAll(result, "__", "_")
	}

	// Trim underscores from start and end
	result = strings.Trim(result, "_")

	if result == "" {
		result = "unnamed_file"
	}

	return result
}

// getFileExtension returns the file extension
func getFileExtension(fileName string) string {
	parts := strings.Split(fileName, ".")
	if len(parts) > 1 {
		return strings.ToLower(parts[len(parts)-1])
	}
	return ""
}

// isAllowedFileType checks if a file type is allowed
func isAllowedFileType(fileName string, allowedTypes []string) bool {
	ext := getFileExtension(fileName)
	if ext == "" {
		return false
	}

	return contains(allowedTypes, ext)
}

// formatBytes formats bytes into human readable format
func formatBytes(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}

// parseDuration parses duration string with multiple formats
func parseDuration(durationStr string) (time.Duration, error) {
	// Try standard duration parsing first
	duration, err := time.ParseDuration(durationStr)
	if err == nil {
		return duration, nil
	}

	// Try parsing as seconds
	var seconds int64
	if _, err := fmt.Sscanf(durationStr, "%ds", &seconds); err == nil {
		return time.Duration(seconds) * time.Second, nil
	}

	// Try parsing as minutes
	var minutes int64
	if _, err := fmt.Sscanf(durationStr, "%dm", &minutes); err == nil {
		return time.Duration(minutes) * time.Minute, nil
	}

	// Try parsing as hours
	var hours int64
	if _, err := fmt.Sscanf(durationStr, "%dh", &hours); err == nil {
		return time.Duration(hours) * time.Hour, nil
	}

	return 0, fmt.Errorf("unable to parse duration: %s", durationStr)
}
