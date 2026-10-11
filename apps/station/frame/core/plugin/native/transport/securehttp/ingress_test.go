package securehttp

import (
	"net/http"
	"testing"
)

func TestStripUntrustedPeerHeadersPreservesAttachmentMetadata(t *testing.T) {
	headers := http.Header{}
	headers.Set(canonicalAttachmentMetadataHeader, "canonical-metadata")
	headers.Set("X-Peers-Remote-Peer", "forged-peer")
	headers.Set("X-Forwarded-For", "203.0.113.9")
	headers.Set("X-Libp2p-Peer", "forged-libp2p-peer")

	stripUntrustedPeerHeaders(headers)

	if got := headers.Get(canonicalAttachmentMetadataHeader); got != "canonical-metadata" {
		t.Fatalf("attachment metadata = %q, want canonical-metadata", got)
	}
	for _, name := range []string{
		"X-Peers-Remote-Peer",
		"X-Forwarded-For",
		"X-Libp2p-Peer",
	} {
		if got := headers.Get(name); got != "" {
			t.Fatalf("%s survived with value %q", name, got)
		}
	}
}
