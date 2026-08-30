package application

import (
	"testing"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

func TestEnrichFriendRequestReplacesInternalIDsWithPTIDs(t *testing.T) {
	request := &chat.FriendRequest{
		SenderPtid:   "ptid:v1:actor:peers:p:alice",
		ReceiverPtid: "ptid:v1:actor:peers:p:bob",
	}
	enrichFriendRequest(request, map[string]actorProfile{
		"ptid:v1:actor:peers:p:alice": {
			Name: "Alice",
			Ptid: "ptid:v1:actor:peers:p:alice",
		},
		"ptid:v1:actor:peers:p:bob": {
			Name: "Bob",
			Ptid: "ptid:v1:actor:peers:p:bob",
		},
	})

	if request.SenderPtid != "ptid:v1:actor:peers:p:alice" {
		t.Fatalf("sender identity leaked internal actor id: %q", request.SenderPtid)
	}
	if request.ReceiverPtid != "ptid:v1:actor:peers:p:bob" {
		t.Fatalf("receiver identity leaked internal actor id: %q", request.ReceiverPtid)
	}
}
