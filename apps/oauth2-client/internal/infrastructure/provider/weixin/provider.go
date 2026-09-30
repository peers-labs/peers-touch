package weixin

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/port"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/provider/common"
)

type Endpoints struct {
	Authorize string
	Token     string
	Refresh   string
	UserInfo  string
}

type Provider struct {
	client    *http.Client
	endpoints Endpoints
	now       func() time.Time
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	OpenID       string `json:"openid"`
	UnionID      string `json:"unionid"`
	Scope        string `json:"scope"`
	ExpiresIn    int64  `json:"expires_in"`
	ErrCode      int    `json:"errcode"`
}

func New() *Provider {
	return NewWithEndpoints(common.DefaultHTTPClient, Endpoints{
		Authorize: "https://open.weixin.qq.com/connect/qrconnect",
		Token:     "https://api.weixin.qq.com/sns/oauth2/access_token",
		Refresh:   "https://api.weixin.qq.com/sns/oauth2/refresh_token",
		UserInfo:  "https://api.weixin.qq.com/sns/userinfo",
	})
}

func NewWithEndpoints(client *http.Client, endpoints Endpoints) *Provider {
	return &Provider{
		client:    client,
		endpoints: endpoints,
		now:       func() time.Time { return time.Now().UTC() },
	}
}

func (p *Provider) Provider() valueobject.Provider { return valueobject.ProviderWeixin }

func (p *Provider) AuthorizeURL(state, _ string, cfg port.ProviderConfig) (string, error) {
	q := url.Values{}
	q.Set("appid", cfg.ClientID)
	q.Set("redirect_uri", cfg.RedirectURI)
	q.Set("response_type", "code")
	q.Set("state", state)
	if cfg.Scope != "" {
		q.Set("scope", cfg.Scope)
	} else {
		q.Set("scope", "snsapi_login")
	}
	return p.endpoints.Authorize + "?" + q.Encode() + "#wechat_redirect", nil
}

func (p *Provider) ExchangeCode(ctx context.Context, code, _ string, cfg port.ProviderConfig) (*entity.AuthorizationGrant, error) {
	tokenEndpoint := p.endpoints.Token + "?" + url.Values{
		"appid":      []string{cfg.ClientID},
		"secret":     []string{cfg.ClientSecret},
		"code":       []string{code},
		"grant_type": []string{"authorization_code"},
	}.Encode()
	tokenBody, err := p.requestToken(ctx, tokenEndpoint)
	if err != nil {
		return nil, err
	}
	obtainedAt := p.now()
	userEndpoint := p.endpoints.UserInfo + "?" + url.Values{
		"access_token": []string{tokenBody.AccessToken},
		"openid":       []string{tokenBody.OpenID},
		"lang":         []string{"zh_CN"},
	}.Encode()
	userResp, err := common.Get(ctx, p.client, userEndpoint, nil)
	if err != nil {
		return nil, errors.New("weixin_userinfo_failed")
	}
	if userResp.StatusCode >= http.StatusBadRequest {
		_ = userResp.Body.Close()
		return nil, errors.New("weixin_userinfo_failed")
	}
	var userBody struct {
		OpenID     string `json:"openid"`
		UnionID    string `json:"unionid"`
		Nickname   string `json:"nickname"`
		HeadImgURL string `json:"headimgurl"`
		ErrCode    int    `json:"errcode"`
	}
	if err := common.DecodeJSON(userResp, &userBody); err != nil {
		return nil, errors.New("weixin_userinfo_failed")
	}
	if userBody.ErrCode != 0 || userBody.OpenID != tokenBody.OpenID {
		return nil, errors.New("weixin_userinfo_invalid")
	}
	unionID := userBody.UnionID
	if unionID == "" {
		unionID = tokenBody.UnionID
	}
	return &entity.AuthorizationGrant{
		Identity: entity.ProviderIdentity{
			ProviderUserID: tokenBody.OpenID,
			UnionID:        unionID,
			Username:       userBody.Nickname,
			DisplayName:    userBody.Nickname,
			AvatarURL:      userBody.HeadImgURL,
		},
		Tokens: entity.TokenSet{
			AccessToken:     tokenBody.AccessToken,
			RefreshToken:    tokenBody.RefreshToken,
			TokenType:       "Bearer",
			Scope:           tokenBody.Scope,
			ObtainedAt:      obtainedAt,
			AccessExpiresAt: expiry(obtainedAt, tokenBody.ExpiresIn),
		},
	}, nil
}

func (p *Provider) RefreshToken(ctx context.Context, refreshToken string, cfg port.ProviderConfig) (*entity.TokenSet, error) {
	if refreshToken == "" {
		return nil, errors.New("credential_not_refreshable")
	}
	endpoint := p.endpoints.Refresh + "?" + url.Values{
		"appid":         []string{cfg.ClientID},
		"grant_type":    []string{"refresh_token"},
		"refresh_token": []string{refreshToken},
	}.Encode()
	tokenBody, err := p.requestToken(ctx, endpoint)
	if err != nil {
		return nil, err
	}
	now := p.now()
	return &entity.TokenSet{
		AccessToken:     tokenBody.AccessToken,
		RefreshToken:    tokenBody.RefreshToken,
		TokenType:       "Bearer",
		Scope:           tokenBody.Scope,
		ObtainedAt:      now,
		AccessExpiresAt: expiry(now, tokenBody.ExpiresIn),
	}, nil
}

func (p *Provider) requestToken(ctx context.Context, endpoint string) (*tokenResponse, error) {
	response, err := common.Get(ctx, p.client, endpoint, nil)
	if err != nil {
		return nil, errors.New("weixin_token_failed")
	}
	if response.StatusCode >= http.StatusBadRequest {
		_ = response.Body.Close()
		return nil, errors.New("weixin_token_failed")
	}
	var body tokenResponse
	if err := common.DecodeJSON(response, &body); err != nil {
		return nil, errors.New("weixin_token_failed")
	}
	if body.ErrCode != 0 || body.AccessToken == "" || body.OpenID == "" {
		return nil, errors.New("weixin_token_invalid")
	}
	return &body, nil
}

func expiry(now time.Time, seconds int64) *time.Time {
	if seconds <= 0 {
		return nil
	}
	value := now.Add(time.Duration(seconds) * time.Second)
	return &value
}
