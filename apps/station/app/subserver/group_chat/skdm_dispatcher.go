package group_chat

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/group_chat/domain"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/encoding/protojson"
)

var errGroupSkdmTransportUnavailable = errors.New("group skdm transport unavailable")

type groupSkdmTransport interface {
	DeliverGroupSkdmEnvelope(ctx context.Context, targetStationPeerID string, req *chat.SubmitGroupSkdmEnvelopeRequest, token string) (*chat.SubmitGroupSkdmEnvelopeResponse, error)
}

type relayGroupSkdmTransport struct {
	httpClient *http.Client
}

func (tr relayGroupSkdmTransport) DeliverGroupSkdmEnvelope(ctx context.Context, targetStationPeerID string, req *chat.SubmitGroupSkdmEnvelopeRequest, token string) (*chat.SubmitGroupSkdmEnvelopeResponse, error) {
	rc := nativefed.RelayClient()
	if rc == nil {
		return nil, errGroupSkdmTransportUnavailable
	}
	base := strings.TrimRight(rc.BaseURL(), "/")
	relayToken := strings.TrimSpace(rc.Token())
	if base == "" || relayToken == "" {
		return nil, errGroupSkdmTransportUnavailable
	}
	body, err := protojson.Marshal(req)
	if err != nil {
		return nil, err
	}
	target := fmt.Sprintf("%s/relay/forward/%s/group-chat/skdm/deliver", base, url.PathEscape(targetStationPeerID))
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+relayToken)
	httpReq.Header.Set(nativefed.ForwardAuthorizationHeader, "Bearer "+token)

	client := tr.httpClient
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		return nil, proposalDispatchError(resp.StatusCode, string(raw))
	}
	var decoded chat.SubmitGroupSkdmEnvelopeResponse
	if err := protojson.Unmarshal(raw, &decoded); err != nil {
		return nil, err
	}
	return &decoded, nil
}

func (s *subServer) dispatchGroupSkdmOutbox(ctx context.Context, limit int) int {
	if s == nil || s.service == nil || s.skdmTransport == nil {
		return 0
	}
	items, err := s.service.ListPendingGroupSkdmOutbox(limit, time.Now())
	if err != nil {
		return 0
	}
	dispatched := 0
	for _, item := range items {
		if err := s.dispatchGroupSkdmOutboxItem(ctx, item); err != nil {
			nextAttemptAt := time.Now().Add(proposalOutboxRetryDelay(item.AttemptCount + 1))
			s.service.MarkGroupSkdmOutboxRetry(item.OutboxULID, err.Error(), nextAttemptAt)
			continue
		}
		dispatched++
	}
	return dispatched
}

func (s *subServer) dispatchGroupSkdmOutboxItem(ctx context.Context, item domain.GroupSkdmEnvelope) error {
	if strings.TrimSpace(item.OutboxULID) == "" {
		return errors.New("skdm outbox item missing outbox ulid")
	}
	req := &chat.SubmitGroupSkdmEnvelopeRequest{Envelope: groupSkdmEnvelopeToProto(item)}
	token, err := s.mintGroupSkdmOutboxToken(ctx, item)
	if err != nil {
		return err
	}
	resp, err := s.skdmTransport.DeliverGroupSkdmEnvelope(ctx, item.RecipientHomeStationPeerID, req, token)
	if err != nil {
		return err
	}
	if resp == nil || strings.TrimSpace(resp.GetOutboxUlid()) == "" {
		return errors.New("skdm dispatch returned empty delivery receipt")
	}
	if !s.service.MarkGroupSkdmOutboxDelivered(item.OutboxULID) {
		return errors.New("skdm dispatch delivered but outbox row was not updated")
	}
	return nil
}

func (s *subServer) mintGroupSkdmOutboxToken(ctx context.Context, item domain.GroupSkdmEnvelope) (string, error) {
	if s.proposalKeyCache == nil {
		return "", errGroupSkdmTransportUnavailable
	}
	issuer := strings.TrimSpace(s.localStationID)
	if issuer == "" {
		issuer = localFederationAudience()
	}
	audience := strings.TrimSpace(item.RecipientHomeStationPeerID)
	subject := strings.TrimSpace(item.SenderDID)
	idempotencyKey := strings.TrimSpace(item.IdempotencyKey)
	if issuer == "" || audience == "" || subject == "" || idempotencyKey == "" {
		return "", errors.New("skdm outbox token requires issuer, audience, subject, and idempotency key")
	}
	return authfed.Mint(ctx, s.proposalKeyCache, authfed.MintRequest{
		Scope:    groupChatSkdmDeliverScopeName,
		Issuer:   issuer,
		Audience: audience,
		Subject:  subject,
		TTL:      groupChatProposalMaxTTL,
		Custom: map[string]string{
			groupChatProposalClaimGroup:   item.GroupID,
			groupChatProposalClaimActor:   subject,
			groupChatSkdmClaimIdempotency: idempotencyKey,
			groupChatSkdmClaimRecipient:   item.RecipientDID,
			groupChatSkdmClaimDevice:      item.RecipientDeviceID,
		},
	})
}
