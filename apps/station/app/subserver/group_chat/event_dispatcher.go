package group_chat

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/group_chat/domain"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/encoding/protojson"
)

var errGroupEventTransportUnavailable = errors.New("group event transport unavailable")

type groupEventTransport interface {
	ApplyGroupEvent(ctx context.Context, targetStationPeerID string, req *chat.ApplyGroupEventRequest, token string) (*chat.ApplyGroupEventResponse, error)
	SyncGroupEvents(ctx context.Context, targetStationPeerID string, req *chat.SyncGroupEventsRequest, token string) (*chat.SyncGroupEventsResponse, error)
	SyncGroupProjection(ctx context.Context, targetStationPeerID string, req *chat.SyncGroupProjectionRequest, token string) (*chat.SyncGroupProjectionResponse, error)
}

type relayGroupEventTransport struct {
	httpClient *http.Client
}

func (tr relayGroupEventTransport) ApplyGroupEvent(ctx context.Context, targetStationPeerID string, req *chat.ApplyGroupEventRequest, token string) (*chat.ApplyGroupEventResponse, error) {
	rc := nativefed.RelayClient()
	if rc == nil {
		return nil, errGroupEventTransportUnavailable
	}
	base := strings.TrimRight(rc.BaseURL(), "/")
	relayToken := strings.TrimSpace(rc.Token())
	if base == "" || relayToken == "" {
		return nil, errGroupEventTransportUnavailable
	}
	body, err := protojson.Marshal(req)
	if err != nil {
		return nil, err
	}
	target := fmt.Sprintf("%s/relay/forward/%s/group-chat/event/apply", base, url.PathEscape(targetStationPeerID))
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
	var decoded chat.ApplyGroupEventResponse
	if err := protojson.Unmarshal(raw, &decoded); err != nil {
		return nil, err
	}
	return &decoded, nil
}

func (tr relayGroupEventTransport) SyncGroupEvents(ctx context.Context, targetStationPeerID string, req *chat.SyncGroupEventsRequest, token string) (*chat.SyncGroupEventsResponse, error) {
	rc := nativefed.RelayClient()
	if rc == nil {
		return nil, errGroupEventTransportUnavailable
	}
	base := strings.TrimRight(rc.BaseURL(), "/")
	relayToken := strings.TrimSpace(rc.Token())
	if base == "" || relayToken == "" {
		return nil, errGroupEventTransportUnavailable
	}
	body, err := protojson.Marshal(req)
	if err != nil {
		return nil, err
	}
	target := fmt.Sprintf("%s/relay/forward/%s/group-chat/event/sync", base, url.PathEscape(targetStationPeerID))
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
	var decoded chat.SyncGroupEventsResponse
	if err := protojson.Unmarshal(raw, &decoded); err != nil {
		return nil, err
	}
	return &decoded, nil
}

func (tr relayGroupEventTransport) SyncGroupProjection(ctx context.Context, targetStationPeerID string, req *chat.SyncGroupProjectionRequest, token string) (*chat.SyncGroupProjectionResponse, error) {
	rc := nativefed.RelayClient()
	if rc == nil {
		return nil, errGroupEventTransportUnavailable
	}
	base := strings.TrimRight(rc.BaseURL(), "/")
	relayToken := strings.TrimSpace(rc.Token())
	if base == "" || relayToken == "" {
		return nil, errGroupEventTransportUnavailable
	}
	body, err := protojson.Marshal(req)
	if err != nil {
		return nil, err
	}
	target := fmt.Sprintf("%s/relay/forward/%s/group-chat/projection/sync", base, url.PathEscape(targetStationPeerID))
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
	var decoded chat.SyncGroupProjectionResponse
	if err := protojson.Unmarshal(raw, &decoded); err != nil {
		return nil, err
	}
	return &decoded, nil
}

func (s *subServer) dispatchFederationOutbox(ctx context.Context, limit int) int {
	if s == nil || s.service == nil || s.eventTransport == nil {
		return 0
	}
	items, err := s.service.ListPendingFederationOutbox(limit, time.Now())
	if err != nil {
		return 0
	}
	dispatched := 0
	for _, item := range items {
		if err := s.dispatchFederationOutboxItem(ctx, item); err != nil {
			nextAttemptAt := time.Now().Add(proposalOutboxRetryDelay(item.AttemptCount + 1))
			s.service.MarkFederationOutboxRetry(item.EventULID, item.TargetStationPeerID, err.Error(), nextAttemptAt)
			continue
		}
		dispatched++
	}
	return dispatched
}

func (s *subServer) dispatchFederationOutboxItem(ctx context.Context, item domain.FederationOutboxItem) error {
	event := item.Event
	if strings.TrimSpace(event.EventULID) == "" {
		return errors.New("federation outbox item missing group event envelope")
	}
	req := &chat.ApplyGroupEventRequest{Event: groupEventToProto(event)}
	token, err := s.mintFederationOutboxToken(ctx, item.TargetStationPeerID, req.GetEvent())
	if err != nil {
		return err
	}
	resp, err := s.eventTransport.ApplyGroupEvent(ctx, item.TargetStationPeerID, req, token)
	if err != nil {
		return err
	}
	if resp == nil || resp.GetLastAcceptedSeq() < event.Seq {
		return errors.New("event dispatch returned stale follower cursor")
	}
	if !s.service.MarkFederationOutboxApplied(event.EventULID, item.TargetStationPeerID) {
		return errors.New("event dispatch applied but outbox row was not updated")
	}
	return nil
}

func (s *subServer) mintFederationOutboxToken(ctx context.Context, targetStationPeerID string, event *chat.GroupEvent) (string, error) {
	if s.proposalKeyCache == nil {
		return "", errGroupEventTransportUnavailable
	}
	issuer := strings.TrimSpace(event.GetAuthorityStationPeerId())
	audience := strings.TrimSpace(targetStationPeerID)
	if issuer == "" || audience == "" {
		return "", errors.New("event outbox token requires issuer and audience")
	}
	return authfed.Mint(ctx, s.proposalKeyCache, authfed.MintRequest{
		Scope:    groupChatEventApplyScopeName,
		Issuer:   issuer,
		Audience: audience,
		Subject:  issuer,
		TTL:      groupChatProposalMaxTTL,
		Custom: map[string]string{
			groupChatProposalClaimGroup: event.GetGroupUlid(),
			groupChatEventClaimEvent:    event.GetEventUlid(),
			groupChatEventClaimSeq:      strconv.FormatInt(event.GetSeq(), 10),
		},
	})
}

func (s *subServer) dispatchFollowerEventSync(ctx context.Context, limit int) int {
	if s == nil || s.service == nil || s.appService == nil || s.eventTransport == nil {
		return 0
	}
	projections, err := s.service.ListFollowerProjections(limit)
	if err != nil {
		return 0
	}
	synced := 0
	for _, projection := range projections {
		if err := s.dispatchFollowerEventSyncItem(ctx, projection); err != nil {
			s.service.MarkFollowerProjectionDegraded(
				projection.GroupID,
				projection.AuthorityStationPeerID,
				"authority event sync failed: "+err.Error(),
			)
			continue
		}
		synced++
	}
	return synced
}

func (s *subServer) dispatchFollowerEventSyncItem(ctx context.Context, projection domain.FollowerProjection) error {
	authority := strings.TrimSpace(projection.AuthorityStationPeerID)
	groupID := strings.TrimSpace(projection.GroupID)
	if authority == "" || groupID == "" {
		return errors.New("follower sync requires authority and group")
	}
	req := &chat.SyncGroupEventsRequest{
		GroupUlid: groupID,
		AfterSeq:  projection.LastSeq,
		Limit:     100,
	}
	token, err := s.mintFollowerEventSyncToken(ctx, authority, groupID)
	if err != nil {
		return err
	}
	resp, err := s.eventTransport.SyncGroupEvents(ctx, authority, req, token)
	if err != nil {
		return err
	}
	if resp == nil {
		return errors.New("event sync returned empty response")
	}
	finalProjection := projection
	for _, event := range resp.GetEvents() {
		applied, err := s.appService.ApplyFederationEvent(groupEventFromProto(event))
		if err != nil {
			return err
		}
		finalProjection = applied
	}
	if finalProjection.Status == followerProjectionStatusReadOnly {
		return errors.New("follower projection is read-only")
	}
	if err := s.syncFollowerProjectionSnapshot(ctx, authority, finalProjection); err != nil {
		return err
	}
	s.service.MarkFollowerProjectionActive(groupID, authority)
	return nil
}

func (s *subServer) syncFollowerProjectionSnapshot(ctx context.Context, authority string, projection domain.FollowerProjection) error {
	beforeCursor := ""
	firstPage := true
	for page := 0; page < 20; page++ {
		req := &chat.SyncGroupProjectionRequest{
			GroupUlid:         projection.GroupID,
			AppliedSeq:        projection.LastSeq,
			AppliedEventHash:  projection.LastEventHash,
			BeforeMessageUlid: beforeCursor,
			MemberLimit:       500,
			MemberOffset:      0,
			MessageLimit:      100,
		}
		if !firstPage {
			req.MemberLimit = 0
		}
		token, err := s.mintFollowerProjectionSyncToken(ctx, authority, projection.GroupID, projection.LastSeq, projection.LastEventHash)
		if err != nil {
			return err
		}
		resp, err := s.eventTransport.SyncGroupProjection(ctx, authority, req, token)
		if err != nil {
			return err
		}
		if resp == nil || resp.GetGroup() == nil {
			return errors.New("projection sync returned empty response")
		}
		members := make([]domain.Member, 0, len(resp.GetMembers()))
		for _, item := range resp.GetMembers() {
			members = append(members, groupMemberFromProto(item))
		}
		messages := make([]domain.Message, 0, len(resp.GetMessages()))
		for _, item := range resp.GetMessages() {
			messages = append(messages, groupMessageFromProto(item))
		}
		if err := s.appService.MaterializeFollowerProjection(groupFromProto(resp.GetGroup()), members, messages); err != nil {
			return err
		}
		if !resp.GetHasMoreMessages() {
			return nil
		}
		beforeCursor = strings.TrimSpace(resp.GetNextMessageCursor())
		if beforeCursor == "" {
			return errors.New("projection sync has_more without next cursor")
		}
		firstPage = false
	}
	return errors.New("projection sync exceeded page limit")
}

func (s *subServer) mintFollowerEventSyncToken(ctx context.Context, authorityStationPeerID, groupID string) (string, error) {
	if s.proposalKeyCache == nil {
		return "", errGroupEventTransportUnavailable
	}
	issuer := strings.TrimSpace(s.localStationID)
	if issuer == "" || issuer == foundationLocalAuthorityStation {
		issuer = localFederationAudience()
	}
	audience := strings.TrimSpace(authorityStationPeerID)
	if issuer == "" || audience == "" || strings.TrimSpace(groupID) == "" {
		return "", errors.New("event sync token requires issuer, audience, and group")
	}
	return authfed.Mint(ctx, s.proposalKeyCache, authfed.MintRequest{
		Scope:    groupChatEventSyncScopeName,
		Issuer:   issuer,
		Audience: audience,
		Subject:  issuer,
		TTL:      groupChatProposalMaxTTL,
		Custom: map[string]string{
			groupChatProposalClaimGroup: groupID,
		},
	})
}

func (s *subServer) mintFollowerProjectionSyncToken(ctx context.Context, authorityStationPeerID, groupID string, appliedSeq int64, appliedEventHash string) (string, error) {
	if s.proposalKeyCache == nil {
		return "", errGroupEventTransportUnavailable
	}
	issuer := strings.TrimSpace(s.localStationID)
	if issuer == "" || issuer == foundationLocalAuthorityStation {
		issuer = localFederationAudience()
	}
	audience := strings.TrimSpace(authorityStationPeerID)
	if issuer == "" || audience == "" || strings.TrimSpace(groupID) == "" {
		return "", errors.New("projection sync token requires issuer, audience, and group")
	}
	return authfed.Mint(ctx, s.proposalKeyCache, authfed.MintRequest{
		Scope:    groupChatProjectionSyncScopeName,
		Issuer:   issuer,
		Audience: audience,
		Subject:  issuer,
		TTL:      groupChatProposalMaxTTL,
		Custom: map[string]string{
			groupChatProposalClaimGroup: groupID,
			groupChatEventClaimSeq:      strconv.FormatInt(appliedSeq, 10),
			groupChatEventClaimEvent:    appliedEventHash,
		},
	})
}
