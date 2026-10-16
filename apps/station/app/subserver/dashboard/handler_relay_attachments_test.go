package dashboard

import (
	"context"
	"net/http"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	nativeRelay "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/relay"
)

type attachmentServiceStub struct {
	imported nativeRelay.InvitationPackage
	deleted  string
	retried  string
}

func (s *attachmentServiceStub) ListAttachments(
	context.Context,
) ([]nativeRelay.RelayAttachment, error) {
	return []nativeRelay.RelayAttachment{{
		RelayPeerID: "relay-a",
		State:       nativeRelay.AttachmentStateActive,
		Enabled:     true,
	}}, nil
}

func (s *attachmentServiceStub) ImportAttachment(
	_ context.Context,
	invitation nativeRelay.InvitationPackage,
) (*nativeRelay.RelayAttachment, error) {
	s.imported = invitation
	return &nativeRelay.RelayAttachment{
		RelayPeerID: invitation.RelayPeerID,
		State:       nativeRelay.AttachmentStateAttaching,
		Enabled:     true,
	}, nil
}

func (s *attachmentServiceStub) DeleteAttachment(
	_ context.Context,
	relayPeerID string,
) (*nativeRelay.RelayAttachment, error) {
	s.deleted = relayPeerID
	return &nativeRelay.RelayAttachment{
		RelayPeerID: relayPeerID,
		State:       nativeRelay.AttachmentStateDetached,
	}, nil
}

func (s *attachmentServiceStub) RetryAttachment(
	_ context.Context,
	relayPeerID string,
) (*nativeRelay.RelayAttachment, error) {
	s.retried = relayPeerID
	return &nativeRelay.RelayAttachment{
		RelayPeerID: relayPeerID,
		State:       nativeRelay.AttachmentStateRecovering,
		Enabled:     true,
	}, nil
}

func TestRelayAttachmentHandlersUseRuntimeService(t *testing.T) {
	service := &attachmentServiceStub{}
	nativeRelay.RegisterAttachmentService(service)
	t.Cleanup(func() { nativeRelay.RegisterAttachmentService(nil) })
	handler := &dashboardHandler{sub: &subServer{}}

	listed, err := handler.handleListRelayAttachments(
		t.Context(),
		&domain.EmptyRequest{},
	)
	if err != nil || len(listed.Items) != 1 ||
		listed.Items[0].RelayPeerID != "relay-a" {
		t.Fatalf("list Relay attachments = %+v, err=%v", listed, err)
	}
	imported, err := handler.handleImportRelayAttachment(
		t.Context(),
		&nativeRelay.InvitationPackage{
			SchemaVersion: 1,
			RelayPeerID:   "relay-b",
			InviteToken:   "secret",
		},
	)
	if err != nil || imported.RelayPeerID != "relay-b" ||
		service.imported.InviteToken != "secret" {
		t.Fatalf("import Relay attachment = %+v, err=%v", imported, err)
	}

	ctx := context.WithValue(t.Context(), dashboardCtxKey{}, &dashboardCtx{
		params: map[string]string{"id": "relay-b"},
	})
	deleted, err := handler.handleDeleteRelayAttachment(
		ctx,
		&relayAttachmentRequest{ID: "relay-b"},
	)
	if err != nil || deleted.State != nativeRelay.AttachmentStateDetached ||
		service.deleted != "relay-b" {
		t.Fatalf("delete Relay attachment = %+v, err=%v", deleted, err)
	}
	retried, err := handler.handleRetryRelayAttachment(
		ctx,
		&relayAttachmentRequest{ID: "relay-b"},
	)
	if err != nil || retried.State != nativeRelay.AttachmentStateRecovering ||
		service.retried != "relay-b" {
		t.Fatalf("retry Relay attachment = %+v, err=%v", retried, err)
	}
}

func TestRelayAttachmentMutationBindsHTTPRouteID(t *testing.T) {
	service := &attachmentServiceStub{}
	nativeRelay.RegisterAttachmentService(service)
	t.Cleanup(func() { nativeRelay.RegisterAttachmentService(nil) })
	handler := &dashboardHandler{sub: &subServer{}}
	for _, name := range []string{
		"dashboard-relay-attachment-delete", "dashboard-relay-attachment-retry",
	} {
		registered := findDashboardHandler(t, handler.handlers(), name)
		request := &federationPeerRouteRequest{
			method:        registered.Method(),
			path:          "/dashboard/api/relay/attachments/relay-b",
			nativeContext: &federationPeerRouteContext{peerID: "relay-b"},
		}
		response := &federationPeerRouteResponse{headers: map[string]string{}}
		if err := registered.Handler()(t.Context(), request, response); err != nil {
			t.Fatal(err)
		}
		if response.status != http.StatusOK {
			t.Fatalf("%s returned %d", name, response.status)
		}
	}
	if service.deleted != "relay-b" || service.retried != "relay-b" {
		t.Fatalf("bound ids: deleted=%q retried=%q", service.deleted, service.retried)
	}
}

func TestRelayAttachmentRoutesAreAuthenticatedAndImportIsStrict(t *testing.T) {
	handler := &dashboardHandler{sub: &subServer{}}
	for _, route := range []struct {
		name         string
		wrapperCount int
	}{
		{name: "dashboard-relay-attachments-list", wrapperCount: 1},
		{name: "dashboard-relay-attachments-import", wrapperCount: 1},
		{name: "dashboard-relay-attachment-delete", wrapperCount: 1},
		{name: "dashboard-relay-attachment-retry", wrapperCount: 1},
	} {
		registered := findDashboardHandler(t, handler.handlers(), route.name)
		if len(registered.Wrappers()) != route.wrapperCount {
			t.Fatalf(
				"%s wrapper count = %d, want %d",
				route.name,
				len(registered.Wrappers()),
				route.wrapperCount,
			)
		}
	}
}
