package application

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
)

func TestEnrichFriendRequestReplacesInternalIDsWithPTIDs(t *testing.T) {
	request := &model.SocialFriendRequest{
		Sender: &actor.ActorRef{
			Ptid: "ptid:v1:actor:peers:p:alice",
		},
		Receiver: &actor.ActorRef{
			Ptid: "ptid:v1:actor:peers:p:bob",
		},
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

	if request.GetSender().GetPtid() != "ptid:v1:actor:peers:p:alice" {
		t.Fatalf("sender identity leaked internal actor id: %q", request.GetSender().GetPtid())
	}
	if request.GetReceiver().GetPtid() != "ptid:v1:actor:peers:p:bob" {
		t.Fatalf("receiver identity leaked internal actor id: %q", request.GetReceiver().GetPtid())
	}
}
