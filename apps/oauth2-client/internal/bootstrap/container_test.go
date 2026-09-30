package bootstrap

import "testing"

func TestStorageHTTPClientIsBounded(t *testing.T) {
	if timeout := storageHTTPClient().Timeout; timeout <= 0 {
		t.Fatalf("storage HTTP timeout must be positive, got %s", timeout)
	}
}
