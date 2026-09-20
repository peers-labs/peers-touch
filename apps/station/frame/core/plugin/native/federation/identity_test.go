package federation

import (
	"sync"
	"testing"

	"github.com/libp2p/go-libp2p/core/peer"
)

func TestConcurrentLocalIdentityUpdatesPreserveBothFields(t *testing.T) {
	const iterations = 1000
	expectedPeerID := peer.ID("peer-sixwin")
	expectedDomain := "station.local"

	for range iterations {
		localIdentity.Store(LocalIdentity{})
		start := make(chan struct{})
		var writers sync.WaitGroup
		writers.Add(2)
		go func() {
			defer writers.Done()
			<-start
			SetLocalStationPeerID(expectedPeerID)
		}()
		go func() {
			defer writers.Done()
			<-start
			SetLocalStationDomain(expectedDomain)
		}()
		close(start)
		writers.Wait()

		identity := LocalIdentitySnapshot()
		if identity.StationPeerID != expectedPeerID {
			t.Fatalf(
				"station peer ID = %q, want %q",
				identity.StationPeerID,
				expectedPeerID,
			)
		}
		if identity.StationDomain != expectedDomain {
			t.Fatalf(
				"station domain = %q, want %q",
				identity.StationDomain,
				expectedDomain,
			)
		}
	}
}
