package group_chat

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/encoding/protojson"
)

func TestRelayGroupProposalTransportSeparatesRelayAndPeerAuthorization(t *testing.T) {
	nativefed.ClearRelayClient()
	defer nativefed.ClearRelayClient()

	var sawRelayAuth string
	var sawPeerAuth string
	var sawPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawRelayAuth = r.Header.Get("Authorization")
		sawPeerAuth = r.Header.Get(nativefed.ForwardAuthorizationHeader)
		sawPath = r.URL.Path

		var req chat.AcceptGroupProposalRequest
		if err := protojson.Unmarshal(readTestBody(t, r), &req); err != nil {
			t.Fatalf("decode proposal request: %v", err)
		}
		if req.GetProposal().GetProposalUlid() != "proposal-1" {
			t.Fatalf("unexpected proposal request: %+v", req.GetProposal())
		}
		resp, err := protojson.Marshal(&chat.AcceptGroupProposalResponse{
			Event: &chat.GroupEvent{
				EventUlid:              "event-1",
				GroupUlid:              req.GetProposal().GetGroupUlid(),
				Seq:                    1,
				EventHash:              "hash-1",
				EventType:              "group.proposal.accepted",
				Actor:                  req.GetProposal().GetActor(),
				MembershipEpoch:        req.GetProposal().GetObservedMembershipEpoch(),
				AuthorityStationPeerId: req.GetProposal().GetAuthorityStationPeerId(),
				AuthorityEpoch:         req.GetProposal().GetAuthorityEpoch(),
				ProposalUlid:           req.GetProposal().GetProposalUlid(),
				IdempotencyKey:         req.GetProposal().GetIdempotencyKey(),
			},
		})
		if err != nil {
			t.Fatalf("encode proposal response: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(resp)
	}))
	defer server.Close()
	nativefed.RegisterRelayClient(testRelayClientHandle{baseURL: server.URL, token: "relay-token"})

	resp, err := (relayGroupProposalTransport{httpClient: server.Client()}).SubmitGroupProposal(
		context.Background(),
		"station-a",
		&chat.AcceptGroupProposalRequest{Proposal: &chat.GroupProposal{
			ProposalUlid:            "proposal-1",
			GroupUlid:               "group-1",
			Actor:                   &chat.FederatedActorRef{ActorDid: "actor-1", HomeStationPeerId: "station-b"},
			Command:                 chat.GroupProposalCommand_GROUP_PROPOSAL_COMMAND_MESSAGE_APPEND,
			ObservedMembershipEpoch: 1,
			AuthorityStationPeerId:  "station-a",
			AuthorityEpoch:          1,
			IdempotencyKey:          "proposal-1",
			SigningKeyId:            "actor-1#1",
			Signature:               []byte("signature"),
		}},
		"peer-jwt",
	)
	if err != nil {
		t.Fatalf("submit proposal: %v", err)
	}
	if resp.GetEvent().GetProposalUlid() != "proposal-1" {
		t.Fatalf("unexpected response: %+v", resp.GetEvent())
	}
	if sawPath != "/relay/forward/station-a/group-chat/proposal/accept" {
		t.Fatalf("unexpected relay path: %s", sawPath)
	}
	if sawRelayAuth != "Bearer relay-token" {
		t.Fatalf("expected relay Authorization header, got %q", sawRelayAuth)
	}
	if sawPeerAuth != "Bearer peer-jwt" {
		t.Fatalf("expected forwarded peer auth header, got %q", sawPeerAuth)
	}
}

type testRelayClientHandle struct {
	baseURL string
	token   string
}

func (h testRelayClientHandle) BaseURL() string { return h.baseURL }
func (h testRelayClientHandle) Token() string   { return h.token }
func (h testRelayClientHandle) Publish(context.Context, string, []byte) error {
	return nil
}

func readTestBody(t *testing.T, r *http.Request) []byte {
	t.Helper()
	if r.Body == nil {
		return nil
	}
	defer r.Body.Close()
	buf, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return buf
}
