package social

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

func TestCanonicalDirectParticipantsUsePTIDBoundary(t *testing.T) {
	actors := map[string]*db.Actor{
		"ptid:v1:actor:peers:p:alice": {
			ID:                101,
			PTID:              "ptid:v1:actor:peers:p:alice",
			HomeStationPeerID: "station-a",
		},
		"ptid:v1:actor:peers:p:bob": {
			ID:                202,
			PTID:              "ptid:v1:actor:peers:p:bob",
			HomeStationPeerID: "station-b",
		},
	}

	aPtid, aStation, bPtid, bStation, err := canonicalDirectParticipants(
		actors,
		"ptid:v1:actor:peers:p:alice",
		"ptid:v1:actor:peers:p:bob",
	)
	if err != nil {
		t.Fatalf("canonicalDirectParticipants failed: %v", err)
	}
	if aPtid != actors["ptid:v1:actor:peers:p:alice"].PTID ||
		bPtid != actors["ptid:v1:actor:peers:p:bob"].PTID {
		t.Fatalf("numeric actor ID crossed the PTID boundary: got %q and %q", aPtid, bPtid)
	}
	if aStation != "station-a" || bStation != "station-b" {
		t.Fatalf("home Station binding lost: got %q and %q", aStation, bStation)
	}
}

func TestCanonicalDirectParticipantsRejectMissingPTID(t *testing.T) {
	actors := map[string]*db.Actor{
		"ptid:v1:actor:peers:p:alice": {ID: 101},
		"ptid:v1:actor:peers:p:bob":   {ID: 202, PTID: "ptid:v1:actor:peers:p:bob"},
	}

	if _, _, _, _, err := canonicalDirectParticipants(
		actors,
		"ptid:v1:actor:peers:p:alice",
		"ptid:v1:actor:peers:p:bob",
	); err == nil {
		t.Fatal("expected missing canonical PTID to fail closed")
	}
}
