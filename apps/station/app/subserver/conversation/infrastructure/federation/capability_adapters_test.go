package federation_test

import (
	"bytes"
	"context"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	conversationfederation "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/federation"
	keyexchangemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestCapabilityAdapterBindsCanonicalOwnerServices(t *testing.T) {
	calls := &capabilityCalls{}
	adapter, err := conversationfederation.NewCapabilityAdapter(
		conversationfederation.CapabilityAdapterConfig{
			LocalStationPeerID: testStationB,
			EndpointManifests: conversationfederation.EndpointManifestFunc(func(
				_ context.Context,
				source string,
				request *actormodel.GetActorEndpointManifestRequest,
			) (*actormodel.GetActorEndpointManifestResponse, error) {
				calls.record("manifest", source)
				if source != testStationA || request.GetActor().GetPtid() != testActor {
					t.Fatal("endpoint manifest owner received unbound input")
				}
				return &actormodel.GetActorEndpointManifestResponse{}, nil
			}),
			MLSKeyPackages: conversationfederation.MLSKeyPackageClaimFunc(func(
				_ context.Context,
				source string,
				request *keyexchangemodel.ClaimMlsKeyPackageRequest,
			) (*keyexchangemodel.ClaimMlsKeyPackageResponse, error) {
				calls.record("keypackage", source)
				if source != testStationA ||
					request.GetAuthorityStationPeerId() != testStationA {
					t.Fatal("KeyPackage owner received unbound authority")
				}
				return &keyexchangemodel.ClaimMlsKeyPackageResponse{}, nil
			}),
			LeaveIntents: conversationfederation.LeaveIntentFuncs{
				Submit: func(
					_ context.Context,
					source string,
					request *chatmodel.SubmitFederatedMlsLeaveIntentRequest,
				) (*chatmodel.SubmitFederatedMlsLeaveIntentResponse, error) {
					calls.record("leave-submit", source)
					if request.GetIntent().GetAuthorityStationPeerId() != testStationB {
						t.Fatal("leave owner received wrong authority")
					}
					return &chatmodel.SubmitFederatedMlsLeaveIntentResponse{}, nil
				},
				List: func(
					_ context.Context,
					source string,
					_ *chatmodel.ListFederatedMlsLeaveIntentsRequest,
				) (*chatmodel.ListFederatedMlsLeaveIntentsResponse, error) {
					calls.record("leave-list", source)
					return &chatmodel.ListFederatedMlsLeaveIntentsResponse{}, nil
				},
			},
			EventSync: conversationfederation.EventSyncFunc(func(
				_ context.Context,
				source string,
				_ *chatmodel.SyncAuthorityConversationEventsRequest,
			) (*chatmodel.SyncAuthorityConversationEventsResponse, error) {
				calls.record("event-sync", source)
				return &chatmodel.SyncAuthorityConversationEventsResponse{}, nil
			}),
			Attachments: attachmentOwnerFuncs(t, calls),
		},
	)
	if err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	actor := &actormodel.ActorRef{
		Ptid: testActor,
		Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
	}
	if _, err := adapter.GetEndpointManifest(
		ctx,
		testStationA,
		&actormodel.GetActorEndpointManifestRequest{Actor: actor},
	); err != nil {
		t.Fatal(err)
	}
	if _, err := adapter.ClaimMLSKeyPackage(
		ctx,
		testStationA,
		&keyexchangemodel.ClaimMlsKeyPackageRequest{
			AuthorityPlanId:        "plan-1",
			AuthorityStationPeerId: testStationA,
			Target: &actormodel.ActorDeviceRef{
				Actor:    actor,
				DeviceId: testDevice,
			},
			PlanExpiresAt: timestamppb.New(time.Now().Add(time.Minute)),
		},
	); err != nil {
		t.Fatal(err)
	}
	leaveIntent := &chatmodel.MlsLeaveIntent{
		HomeStationPeerId:      testStationA,
		AuthorityStationPeerId: testStationB,
	}
	if _, err := adapter.SubmitLeaveIntent(
		ctx,
		testStationA,
		&chatmodel.SubmitFederatedMlsLeaveIntentRequest{
			Intent:                  leaveIntent,
			SourceHomeStationPeerId: testStationA,
		},
	); err != nil {
		t.Fatal(err)
	}
	if _, err := adapter.ListLeaveIntents(
		ctx,
		testStationA,
		&chatmodel.ListFederatedMlsLeaveIntentsRequest{
			ConversationId:          "conversation-1",
			SourceHomeStationPeerId: testStationA,
		},
	); err != nil {
		t.Fatal(err)
	}
	if _, err := adapter.SyncAuthorityEvents(
		ctx,
		testStationA,
		&chatmodel.SyncAuthorityConversationEventsRequest{
			FederationId:   "federation-1",
			ConversationId: "conversation-1",
			AuthorityEpoch: 1,
			AfterGroupSeq:  0,
			Limit:          50,
		},
	); err != nil {
		t.Fatal(err)
	}

	attachmentRequests := canonicalAttachmentRequests()
	if _, err := adapter.GetUpload(ctx, testStationA, attachmentRequests.getUpload); err != nil {
		t.Fatal(err)
	}
	if _, err := adapter.BeginUpload(ctx, testStationA, attachmentRequests.begin); err != nil {
		t.Fatal(err)
	}
	if _, err := adapter.PutChunk(
		ctx,
		testStationA,
		attachmentRequests.putChunk,
		bytes.NewReader([]byte("ciphertext")),
	); err != nil {
		t.Fatal(err)
	}
	if _, err := adapter.CompleteUpload(ctx, testStationA, attachmentRequests.complete); err != nil {
		t.Fatal(err)
	}
	if _, err := adapter.CancelUpload(ctx, testStationA, attachmentRequests.cancel); err != nil {
		t.Fatal(err)
	}
	_, body, err := adapter.GetObject(
		ctx,
		testStationA,
		attachmentRequests.getObject,
		0,
		9,
	)
	if err != nil {
		t.Fatal(err)
	}
	if body == nil {
		t.Fatal("attachment owner returned no ciphertext stream")
	}
	if err := body.Close(); err != nil {
		t.Fatal(err)
	}

	for _, name := range []string{
		"manifest",
		"keypackage",
		"leave-submit",
		"leave-list",
		"event-sync",
		"attachment-get-upload",
		"attachment-begin",
		"attachment-put",
		"attachment-complete",
		"attachment-cancel",
		"attachment-get-object",
	} {
		if calls.count(name) != 1 {
			t.Fatalf("%s calls = %d, want 1", name, calls.count(name))
		}
	}
}

func TestCapabilityAdapterRejectsClaimedSourceMismatchBeforeOwnerCall(t *testing.T) {
	called := false
	adapter, err := conversationfederation.NewCapabilityAdapter(
		conversationfederation.CapabilityAdapterConfig{
			LocalStationPeerID: testStationB,
			EndpointManifests: conversationfederation.EndpointManifestFunc(func(
				context.Context,
				string,
				*actormodel.GetActorEndpointManifestRequest,
			) (*actormodel.GetActorEndpointManifestResponse, error) {
				return &actormodel.GetActorEndpointManifestResponse{}, nil
			}),
			MLSKeyPackages: conversationfederation.MLSKeyPackageClaimFunc(func(
				context.Context,
				string,
				*keyexchangemodel.ClaimMlsKeyPackageRequest,
			) (*keyexchangemodel.ClaimMlsKeyPackageResponse, error) {
				called = true
				return &keyexchangemodel.ClaimMlsKeyPackageResponse{}, nil
			}),
			LeaveIntents: conversationfederation.LeaveIntentFuncs{
				Submit: func(
					context.Context,
					string,
					*chatmodel.SubmitFederatedMlsLeaveIntentRequest,
				) (*chatmodel.SubmitFederatedMlsLeaveIntentResponse, error) {
					return &chatmodel.SubmitFederatedMlsLeaveIntentResponse{}, nil
				},
				List: func(
					context.Context,
					string,
					*chatmodel.ListFederatedMlsLeaveIntentsRequest,
				) (*chatmodel.ListFederatedMlsLeaveIntentsResponse, error) {
					return &chatmodel.ListFederatedMlsLeaveIntentsResponse{}, nil
				},
			},
			EventSync: conversationfederation.EventSyncFunc(func(
				context.Context,
				string,
				*chatmodel.SyncAuthorityConversationEventsRequest,
			) (*chatmodel.SyncAuthorityConversationEventsResponse, error) {
				return &chatmodel.SyncAuthorityConversationEventsResponse{}, nil
			}),
			Attachments: attachmentOwnerFuncs(t, &capabilityCalls{}),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	_, err = adapter.ClaimMLSKeyPackage(
		context.Background(),
		testStationA,
		&keyexchangemodel.ClaimMlsKeyPackageRequest{
			AuthorityPlanId:        "plan-1",
			AuthorityStationPeerId: "forged-station",
			Target: &actormodel.ActorDeviceRef{
				Actor: &actormodel.ActorRef{
					Ptid: testActor,
					Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
				},
				DeviceId: testDevice,
			},
			PlanExpiresAt: timestamppb.New(time.Now().Add(time.Minute)),
		},
	)
	if err == nil {
		t.Fatal("source mismatch was accepted")
	}
	if called {
		t.Fatal("source mismatch reached the Key Exchange owner")
	}
	if code, ok := federationdelivery.FailureCodeOf(err); !ok ||
		code != federationdelivery.FailureInvalidFrame {
		t.Fatalf("source mismatch error = %v", err)
	}
}

type capabilityCalls struct {
	mu     sync.Mutex
	counts map[string]int
}

func (c *capabilityCalls) record(name string, source string) {
	if source != testStationA {
		panic("capability adapter changed authenticated source")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.counts == nil {
		c.counts = make(map[string]int)
	}
	c.counts[name]++
}

func (c *capabilityCalls) count(name string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.counts[name]
}

func attachmentOwnerFuncs(
	t *testing.T,
	calls *capabilityCalls,
) conversationfederation.AttachmentDataPlaneFuncs {
	t.Helper()
	return conversationfederation.AttachmentDataPlaneFuncs{
		GetUploadFunc: func(
			_ context.Context,
			source string,
			_ *chatmodel.GetFederatedConversationAttachmentUploadRequest,
		) (*chatmodel.GetFederatedConversationAttachmentUploadResponse, error) {
			calls.record("attachment-get-upload", source)
			return &chatmodel.GetFederatedConversationAttachmentUploadResponse{}, nil
		},
		BeginUploadFunc: func(
			_ context.Context,
			source string,
			_ *chatmodel.BeginFederatedConversationAttachmentUploadRequest,
		) (*chatmodel.BeginFederatedConversationAttachmentUploadResponse, error) {
			calls.record("attachment-begin", source)
			return &chatmodel.BeginFederatedConversationAttachmentUploadResponse{}, nil
		},
		PutChunkFunc: func(
			_ context.Context,
			source string,
			_ *chatmodel.PutFederatedConversationAttachmentChunkRequest,
			body io.Reader,
		) (*chatmodel.PutFederatedConversationAttachmentChunkResponse, error) {
			calls.record("attachment-put", source)
			content, err := io.ReadAll(body)
			if err != nil {
				t.Fatal(err)
			}
			if string(content) != "ciphertext" {
				t.Fatalf("attachment ciphertext = %q", content)
			}
			return &chatmodel.PutFederatedConversationAttachmentChunkResponse{}, nil
		},
		CompleteUploadFunc: func(
			_ context.Context,
			source string,
			_ *chatmodel.CompleteFederatedConversationAttachmentUploadRequest,
		) (*chatmodel.CompleteFederatedConversationAttachmentUploadResponse, error) {
			calls.record("attachment-complete", source)
			return &chatmodel.CompleteFederatedConversationAttachmentUploadResponse{}, nil
		},
		CancelUploadFunc: func(
			_ context.Context,
			source string,
			_ *chatmodel.CancelFederatedConversationAttachmentUploadRequest,
		) (*chatmodel.CancelFederatedConversationAttachmentUploadResponse, error) {
			calls.record("attachment-cancel", source)
			return &chatmodel.CancelFederatedConversationAttachmentUploadResponse{}, nil
		},
		GetObjectFunc: func(
			_ context.Context,
			source string,
			_ *chatmodel.GetFederatedConversationAttachmentObjectRequest,
			start int64,
			end int64,
		) (*chatmodel.GetFederatedConversationAttachmentObjectResponse, io.ReadCloser, error) {
			calls.record("attachment-get-object", source)
			if start != 0 || end != 9 {
				t.Fatalf("attachment range = %d..%d", start, end)
			}
			return &chatmodel.GetFederatedConversationAttachmentObjectResponse{},
				io.NopCloser(strings.NewReader("ciphertext")),
				nil
		},
	}
}

type attachmentRequestSet struct {
	getUpload *chatmodel.GetFederatedConversationAttachmentUploadRequest
	begin     *chatmodel.BeginFederatedConversationAttachmentUploadRequest
	putChunk  *chatmodel.PutFederatedConversationAttachmentChunkRequest
	complete  *chatmodel.CompleteFederatedConversationAttachmentUploadRequest
	cancel    *chatmodel.CancelFederatedConversationAttachmentUploadRequest
	getObject *chatmodel.GetFederatedConversationAttachmentObjectRequest
}

func canonicalAttachmentRequests() attachmentRequestSet {
	return attachmentRequestSet{
		getUpload: &chatmodel.GetFederatedConversationAttachmentUploadRequest{
			Request: &chatmodel.GetAttachmentUploadRequest{
				AuthorityStationId: testStationB,
			},
			SourceHomeStationPeerId: testStationA,
		},
		begin: &chatmodel.BeginFederatedConversationAttachmentUploadRequest{
			Request: &chatmodel.BeginAttachmentUploadRequest{
				AuthorityStationId: testStationB,
			},
			SourceHomeStationPeerId: testStationA,
		},
		putChunk: &chatmodel.PutFederatedConversationAttachmentChunkRequest{
			Request: &chatmodel.PutAttachmentChunkRequest{
				AuthorityStationId: testStationB,
			},
			SourceHomeStationPeerId: testStationA,
		},
		complete: &chatmodel.CompleteFederatedConversationAttachmentUploadRequest{
			Request: &chatmodel.CompleteAttachmentUploadRequest{
				AuthorityStationId: testStationB,
			},
			SourceHomeStationPeerId: testStationA,
		},
		cancel: &chatmodel.CancelFederatedConversationAttachmentUploadRequest{
			Request: &chatmodel.CancelAttachmentUploadRequest{
				AuthorityStationId: testStationB,
			},
			SourceHomeStationPeerId: testStationA,
		},
		getObject: &chatmodel.GetFederatedConversationAttachmentObjectRequest{
			Request: &chatmodel.GetAttachmentObjectRequest{
				AuthorityStationId: testStationB,
			},
			SourceHomeStationPeerId: testStationA,
		},
	}
}
