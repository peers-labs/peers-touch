package follower

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

const authorityEventSyncScope = "conversation-authority-event-sync"

type HTTPAuthorityEventFetcher struct {
	db       *gorm.DB
	client   *http.Client
	keyCache *authfed.KeyCache
}

func NewHTTPAuthorityEventFetcher(
	db *gorm.DB,
	keyCache *authfed.KeyCache,
) *HTTPAuthorityEventFetcher {
	return &HTTPAuthorityEventFetcher{
		db:       db,
		client:   &http.Client{Timeout: 15 * time.Second},
		keyCache: keyCache,
	}
}

func (f *HTTPAuthorityEventFetcher) FetchAuthorityEvents(
	ctx context.Context,
	head Head,
	afterGroupSeq int64,
	limit int32,
) ([]*chat.CommittedConversationEvent, error) {
	membership, err := fedinf.NewRepos(f.db).Membership.GetByStation(
		ctx,
		head.FederationID,
		head.AuthorityStationPeerID,
	)
	if err != nil {
		return nil, err
	}
	if membership == nil || membership.Status != "active" || membership.StationURL == "" {
		return nil, fmt.Errorf("conversation follower: authority endpoint unavailable")
	}
	identity := nativefed.LocalIdentitySnapshot()
	issuer := identity.StationPeerID.String()
	if issuer == "" {
		issuer = identity.StationDomain
	}
	token, err := authfed.Mint(ctx, f.keyCache, authfed.MintRequest{
		Scope:    authorityEventSyncScope,
		Issuer:   issuer,
		Audience: head.AuthorityStationPeerID,
		Subject:  issuer,
		Custom: map[string]string{
			"federation_id":   head.FederationID,
			"conversation_id": head.ConversationID,
			"authority_epoch": strconv.FormatInt(head.AuthorityEpoch, 10),
		},
	})
	if err != nil {
		return nil, err
	}
	body, err := protojson.Marshal(&chat.SyncAuthorityConversationEventsRequest{
		FederationId:   head.FederationID,
		ConversationId: head.ConversationID,
		AuthorityEpoch: head.AuthorityEpoch,
		AfterGroupSeq:  afterGroupSeq,
		Limit:          limit,
	})
	if err != nil {
		return nil, err
	}
	endpoint := strings.TrimRight(membership.StationURL, "/") +
		"/conversation/federation/events/sync"
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
			"conversation follower: authority sync status %d: %s",
			response.StatusCode,
			strings.TrimSpace(string(responseBody)),
		)
	}
	result := &chat.SyncAuthorityConversationEventsResponse{}
	if err := protojson.Unmarshal(responseBody, result); err != nil {
		return nil, err
	}
	return result.Events, nil
}
