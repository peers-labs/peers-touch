package oauth

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/x-config/internal/application/operatorauth"
	"github.com/peers-labs/peers-touch/oauth2-client/model/operatorlogin"
	"google.golang.org/protobuf/proto"
)

const maxRedeemResponseBytes = 64 * 1024

type Redeemer struct {
	endpoint string
	secret   string
	client   *http.Client
}

func NewRedeemer(
	endpoint string,
	secret string,
	client *http.Client,
) (*Redeemer, error) {
	parsed, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil ||
		parsed.Scheme != "https" ||
		parsed.Host == "" ||
		parsed.User != nil ||
		parsed.RawQuery != "" ||
		parsed.Fragment != "" ||
		strings.TrimSpace(secret) == "" {
		return nil, errors.New("invalid_oauth_redeemer_configuration")
	}
	if client == nil {
		client = &http.Client{
			Timeout: 5 * time.Second,
			CheckRedirect: func(
				_ *http.Request,
				_ []*http.Request,
			) error {
				return http.ErrUseLastResponse
			},
		}
	}
	return &Redeemer{
		endpoint: parsed.String(),
		secret:   secret,
		client:   client,
	}, nil
}

func (r *Redeemer) Redeem(
	ctx context.Context,
	request operatorauth.RedeemRequest,
) (*operatorlogin.SignedOperatorLoginAssertion, error) {
	payload, err := (proto.MarshalOptions{Deterministic: true}).Marshal(
		&operatorlogin.RedeemOperatorLoginHandoffRequest{
			HandoffCode:      request.HandoffCode,
			ReceiverVerifier: append([]byte(nil), request.ReceiverVerifier...),
			Audience:         request.Audience,
			SiteId:           request.SiteID,
		},
	)
	if err != nil {
		return nil, errors.New("oauth_redeem_unavailable")
	}
	httpRequest, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		r.endpoint,
		bytes.NewReader(payload),
	)
	if err != nil {
		return nil, errors.New("oauth_redeem_unavailable")
	}
	httpRequest.Header.Set("Accept", "application/protobuf")
	httpRequest.Header.Set("Authorization", "Bearer "+r.secret)
	httpRequest.Header.Set("Content-Type", "application/protobuf")
	response, err := r.client.Do(httpRequest)
	if err != nil {
		return nil, errors.New("oauth_redeem_unavailable")
	}
	defer response.Body.Close()
	body, err := io.ReadAll(
		io.LimitReader(response.Body, maxRedeemResponseBytes+1),
	)
	if err != nil || len(body) > maxRedeemResponseBytes {
		return nil, errors.New("oauth_redeem_unavailable")
	}
	if response.StatusCode != http.StatusOK {
		return nil, errors.New("oauth_redeem_rejected")
	}
	result := &operatorlogin.RedeemOperatorLoginHandoffResponse{}
	if err := proto.Unmarshal(body, result); err != nil ||
		result.GetAssertion() == nil {
		return nil, errors.New("oauth_redeem_invalid")
	}
	canonical, err := (proto.MarshalOptions{Deterministic: true}).Marshal(result)
	if err != nil || !bytes.Equal(canonical, body) {
		return nil, errors.New("oauth_redeem_invalid")
	}
	return result.GetAssertion(), nil
}
