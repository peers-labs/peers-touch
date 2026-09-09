package conversation

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	fedinf "github.com/peers-labs/peers-touch/station/app/subserver/federation/infrastructure"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/encoding/protojson"
	"gorm.io/gorm"
)

type ConversationCommandProposalForwarder interface {
	Forward(
		context.Context,
		*chat.ConversationCommandProposal,
	) (*chat.ConversationCommandProposalResult, error)
}

type HTTPConversationCommandProposalForwarder struct {
	db       *gorm.DB
	client   *http.Client
	keyCache *authfed.KeyCache
}

func NewHTTPConversationCommandProposalForwarder(
	db *gorm.DB,
	keyCache *authfed.KeyCache,
) *HTTPConversationCommandProposalForwarder {
	return &HTTPConversationCommandProposalForwarder{
		db:       db,
		client:   &http.Client{Timeout: 15 * time.Second},
		keyCache: keyCache,
	}
}

func (f *HTTPConversationCommandProposalForwarder) Forward(
	ctx context.Context,
	proposal *chat.ConversationCommandProposal,
) (*chat.ConversationCommandProposalResult, error) {
	if !validCommandProposalShape(proposal) {
		return nil, fmt.Errorf("conversation proposal forward: proposal is incomplete")
	}
	kind := conversationCommandKind(proposal.Command)
	if kind == chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_UNSPECIFIED {
		return nil, fmt.Errorf("conversation proposal forward: unsupported command")
	}
	repos := fedinf.NewRepos(f.db)
	authority, err := repos.Membership.GetByStation(
		ctx,
		proposal.FederationId,
		proposal.AuthorityStationPeerId,
	)
	if err != nil {
		return nil, err
	}
	if authority == nil || authority.Status != "active" || authority.StationURL == "" {
		return nil, fmt.Errorf("conversation proposal forward: authority endpoint unavailable")
	}

	identity := nativefed.LocalIdentitySnapshot()
	issuer := identity.StationPeerID.String()
	if issuer == "" {
		issuer = identity.StationDomain
	}
	if issuer == "" || issuer != proposal.HomeStationPeerId {
		return nil, fmt.Errorf("conversation proposal forward: local Home Station identity mismatch")
	}
	home, err := repos.Membership.GetByStation(ctx, proposal.FederationId, issuer)
	if err != nil {
		return nil, err
	}
	if home == nil || home.Status != "active" {
		return nil, fmt.Errorf("conversation proposal forward: Home Station is not active")
	}

	token, err := authfed.Mint(ctx, f.keyCache, authfed.MintRequest{
		Scope:    conversationCommandProposalScope,
		Issuer:   issuer,
		Audience: proposal.AuthorityStationPeerId,
		Subject:  proposal.ActorPtid,
		Custom: map[string]string{
			proposalClaimFederation:     proposal.FederationId,
			proposalClaimConversation:   proposal.Command.ConversationId,
			proposalClaimCommand:        proposal.Command.CommandId,
			proposalClaimCommandKind:    strconv.Itoa(int(kind)),
			proposalClaimDevice:         proposal.ActorDeviceId,
			proposalClaimSigningKey:     proposal.ActorSigningKeyId,
			proposalClaimCommandHash:    fmt.Sprintf("%x", proposal.CommandSha256),
			proposalClaimAuthorityEpoch: strconv.FormatInt(proposal.AuthorityEpoch, 10),
			proposalClaimExpiresAt:      strconv.FormatInt(proposal.ExpiresAtUnixMs, 10),
		},
	})
	if err != nil {
		return nil, fmt.Errorf("conversation proposal forward: mint peer token: %w", err)
	}
	body, err := protojson.Marshal(&chat.ForwardConversationCommandProposalRequest{
		Proposal: proposal,
	})
	if err != nil {
		return nil, err
	}
	endpoint := strings.TrimRight(authority.StationURL, "/") +
		"/federation/conversation/command-proposal"
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		endpoint,
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := f.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf(
			"conversation proposal forward: authority returned status %d",
			response.StatusCode,
		)
	}
	result := &chat.ForwardConversationCommandProposalResponse{}
	if err := protojson.Unmarshal(responseBody, result); err != nil {
		return nil, err
	}
	if result.Result == nil {
		return nil, fmt.Errorf("conversation proposal forward: authority returned no result")
	}
	return result.Result, nil
}
