package server

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/option"
)

func TestWithMetadataEntryPreservesConfiguredMetadata(t *testing.T) {
	root := &option.Options{}
	root.Apply(option.WithRootCtx(context.Background()))
	root.Apply(
		WithMetadata(map[string]string{"name": "station"}),
		WithMetadataEntry("node_peer_id", "node-peer-a"),
	)

	metadata := root.Ctx().Value(serverOptionsKey{}).(*Options).Metadata
	if metadata["name"] != "station" ||
		metadata["node_peer_id"] != "node-peer-a" {
		t.Fatalf("server metadata was not merged: %+v", metadata)
	}
}
