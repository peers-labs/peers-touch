package application

import (
	"testing"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

func TestEnrichFriendRequestReplacesInternalIDsWithPTIDs(t *testing.T) {
	request := &chat.FriendRequest{
		SenderId:   "101",
		ReceiverId: "202",
	}
	enrichFriendRequest(request, map[uint64]actorProfile{
		101: {
			Name: "Alice",
			Ptid: "ptid:v1:actor:peers:p:alice",
		},
		202: {
			Name: "Bob",
			Ptid: "ptid:v1:actor:peers:p:bob",
		},
	})

	if request.SenderId != "ptid:v1:actor:peers:p:alice" {
		t.Fatalf("sender identity leaked internal actor id: %q", request.SenderId)
	}
	if request.ReceiverId != "ptid:v1:actor:peers:p:bob" {
		t.Fatalf("receiver identity leaked internal actor id: %q", request.ReceiverId)
	}
}
