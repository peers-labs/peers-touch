package app_meta

import (
	"context"
	"testing"
)

func TestHandleVersionReturnsDefaultBuildMetadata(t *testing.T) {
	sub := &subServer{}

	resp, err := sub.handleVersion(context.Background(), &versionRequest{})
	if err != nil {
		t.Fatalf("handleVersion returned error: %v", err)
	}
	if resp.Service != "peers-touch-station" {
		t.Fatalf("expected service peers-touch-station, got %s", resp.Service)
	}
	if resp.BuildCommit == "" || resp.BuildLabel == "" || resp.BuildTime == "" || resp.GoVersion == "" {
		t.Fatalf("expected non-empty version metadata, got %+v", resp)
	}
}

func TestHandleVersionUsesEnvironmentOverrides(t *testing.T) {
	t.Setenv("PEERS_TOUCH_BUILD_COMMIT", "commit-1")
	t.Setenv("PEERS_TOUCH_BUILD_LABEL", "label-1")
	t.Setenv("PEERS_TOUCH_BUILD_TIME", "time-1")
	sub := &subServer{}

	resp, err := sub.handleVersion(context.Background(), &versionRequest{})
	if err != nil {
		t.Fatalf("handleVersion returned error: %v", err)
	}
	if resp.BuildCommit != "commit-1" || resp.BuildLabel != "label-1" || resp.BuildTime != "time-1" {
		t.Fatalf("expected env overrides, got %+v", resp)
	}
}
