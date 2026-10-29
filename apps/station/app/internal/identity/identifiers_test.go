package identity

import (
	"strings"
	"testing"
)

func TestResourceIDPrefixesAndUniqueness(t *testing.T) {
	fed := NewFederationID()
	if !strings.HasPrefix(fed, string(KindFederation)+separator) {
		t.Fatalf("federation id %q missing prefix", fed)
	}
	if kind, ok := KindOf(fed); !ok || kind != KindFederation {
		t.Fatalf("KindOf(%q) = %q,%v want fed,true", fed, kind, ok)
	}
	if fed == NewFederationID() {
		t.Fatal("federation ids must be unique")
	}

	evt := NewLedgerEventID()
	if kind, ok := KindOf(evt); !ok || kind != KindLedgerEvent {
		t.Fatalf("KindOf(%q) = %q,%v want evt,true", evt, kind, ok)
	}
}

func TestUnknownKindIsRejected(t *testing.T) {
	for _, raw := range []string{"", "plainulid", "unknown_01J0", "fed", "evt_"} {
		if kind, ok := KindOf(raw); ok {
			t.Fatalf("KindOf(%q) = %q,true; want false", raw, kind)
		}
	}
}
