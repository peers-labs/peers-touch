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

var errGroupProposalTransportUnavailable = errors.New("group proposal transport unavailable")

type groupProposalTransport interface {
	SubmitGroupProposal(ctx context.Context, authorityStationPeerID string, req *chat.AcceptGroupProposalRequest, token string) (*chat.AcceptGroupProposalResponse, error)
}

type relayGroupProposalTransport struct {
	httpClient *http.Client
}

func (tr relayGroupProposalTransport) SubmitGroupProposal(ctx context.Context, authorityStationPeerID string, req *chat.AcceptGroupProposalRequest, token string) (*chat.AcceptGroupProposalResponse, error) {
	rc := nativefed.RelayClient()
	if rc == nil {
		return nil, errGroupProposalTransportUnavailable
	}
	base := strings.TrimRight(rc.BaseURL(), "/")
	relayToken := strings.TrimSpace(rc.Token())
	if base == "" || relayToken == "" {
		return nil, errGroupProposalTransportUnavailable
	}
	body, err := protojson.Marshal(req)
	if err != nil {
		return nil, err
	}
	target := fmt.Sprintf("%s/relay/forward/%s/group-chat/proposal/accept", base, url.PathEscape(authorityStationPeerID))
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
	var decoded chat.AcceptGroupProposalResponse
	if err := protojson.Unmarshal(raw, &decoded); err != nil {
		return nil, err
	}
	return &decoded, nil
}

func (s *subServer) dispatchProposalOutbox(ctx context.Context, limit int) int {
	if s == nil || s.service == nil || s.proposalTransport == nil {
		return 0
	}
	items, err := s.service.ListPendingProposalOutbox(limit, time.Now())
	if err != nil {
		return 0
	}
	dispatched := 0
	for _, item := range items {
		if err := s.dispatchProposalOutboxItem(ctx, item); err != nil {
			nextAttemptAt := time.Now().Add(proposalOutboxRetryDelay(item.AttemptCount + 1))
			s.service.MarkProposalOutboxRetry(item.ProposalULID, err.Error(), nextAttemptAt)
			continue
		}
		dispatched++
	}
	return dispatched
}

func (s *subServer) dispatchProposalOutboxItem(ctx context.Context, item domain.GroupProposalOutboxItem) error {
	proposal := item.Proposal
	if strings.TrimSpace(proposal.ProposalULID) == "" {
		return errors.New("proposal outbox item missing proposal envelope")
	}
	req := &chat.AcceptGroupProposalRequest{Proposal: groupProposalToProto(proposal)}
	token, err := s.mintProposalOutboxToken(ctx, proposalTokenViewFromProto(req.GetProposal()))
	if err != nil {
		return err
	}
	resp, err := s.proposalTransport.SubmitGroupProposal(ctx, proposal.AuthorityStationPeerID, req, token)
	if err != nil {
		return err
	}
	if resp == nil || resp.GetEvent() == nil {
		return errors.New("proposal dispatch returned empty acceptance")
	}
	if !s.service.MarkProposalOutboxAccepted(proposal.ProposalULID) {
		return errors.New("proposal dispatch accepted but outbox row was not updated")
	}
	return nil
}

func proposalOutboxRetryDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	if attempt > 6 {
		attempt = 6
	}
	return time.Duration(1<<uint(attempt-1)) * time.Second
}

func (s *subServer) mintProposalOutboxToken(ctx context.Context, proposal chatProposalLike) (string, error) {
	if s.proposalKeyCache == nil {
		return "", errGroupProposalTransportUnavailable
	}
	issuer := strings.TrimSpace(proposal.ActorHomeStationPeerID())
	audience := strings.TrimSpace(proposal.AuthorityStationPeerID())
	subject := strings.TrimSpace(proposal.ActorDID())
	if issuer == "" || audience == "" || subject == "" {
		return "", errors.New("proposal outbox token requires issuer, audience, and subject")
	}
	return authfed.Mint(ctx, s.proposalKeyCache, authfed.MintRequest{
		Scope:    groupChatProposalScopeName,
		Issuer:   issuer,
		Audience: audience,
		Subject:  subject,
		TTL:      groupChatProposalMaxTTL,
		Custom: map[string]string{
			groupChatProposalClaimGroup:    proposal.GroupID(),
			groupChatProposalClaimProposal: proposal.ProposalULID(),
			groupChatProposalClaimActor:    subject,
		},
	})
}

type chatProposalLike interface {
	ProposalULID() string
	GroupID() string
	ActorDID() string
	ActorHomeStationPeerID() string
	AuthorityStationPeerID() string
}

type groupProposalTokenView struct {
	proposalULID           string
	groupID                string
	actorDID               string
	actorHomeStationPeerID string
	authorityStationPeerID string
}

func (v groupProposalTokenView) ProposalULID() string           { return v.proposalULID }
func (v groupProposalTokenView) GroupID() string                { return v.groupID }
func (v groupProposalTokenView) ActorDID() string               { return v.actorDID }
func (v groupProposalTokenView) ActorHomeStationPeerID() string { return v.actorHomeStationPeerID }
func (v groupProposalTokenView) AuthorityStationPeerID() string { return v.authorityStationPeerID }

func proposalTokenViewFromProto(proposal *chat.GroupProposal) groupProposalTokenView {
	if proposal == nil {
		return groupProposalTokenView{}
	}
	return groupProposalTokenView{
		proposalULID:           proposal.GetProposalUlid(),
		groupID:                proposal.GetGroupUlid(),
		actorDID:               proposal.GetActor().GetActorDid(),
		actorHomeStationPeerID: proposal.GetActor().GetHomeStationPeerId(),
		authorityStationPeerID: proposal.GetAuthorityStationPeerId(),
	}
}

func proposalDispatchError(status int, body string) error {
	body = strings.TrimSpace(body)
	if body == "" {
		return fmt.Errorf("proposal dispatch failed status=%d", status)
	}
	return fmt.Errorf("proposal dispatch failed status=%d body=%s", status, body)
}
