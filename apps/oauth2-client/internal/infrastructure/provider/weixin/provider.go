package weixin

import (
	"context"
	"errors"
	"net/http"
	"net/url"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/port"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/provider/common"
)

type Provider struct{}

func New() *Provider { return &Provider{} }

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
	return "https://open.weixin.qq.com/connect/qrconnect?" + q.Encode() + "#wechat_redirect", nil
}

func (p *Provider) ExchangeCode(ctx context.Context, code string, cfg port.ProviderConfig) (*port.ProviderIdentity, error) {
	tokenEndpoint := "https://api.weixin.qq.com/sns/oauth2/access_token?" + url.Values{
		"appid":      []string{cfg.ClientID},
		"secret":     []string{cfg.ClientSecret},
		"code":       []string{code},
		"grant_type": []string{"authorization_code"},
	}.Encode()
	tokenResp, err := common.Get(ctx, tokenEndpoint, nil)
	if err != nil {
		return nil, err
	}
	if tokenResp.StatusCode >= http.StatusBadRequest {
		return nil, errors.New("weixin_token_failed")
	}
	var tokenBody struct {
		AccessToken string `json:"access_token"`
		OpenID      string `json:"openid"`
		UnionID     string `json:"unionid"`
		ErrCode     int    `json:"errcode"`
	}
	if err := common.DecodeJSON(tokenResp, &tokenBody); err != nil {
		return nil, err
	}
	if tokenBody.ErrCode != 0 || tokenBody.AccessToken == "" || tokenBody.OpenID == "" {
		return nil, errors.New("weixin_token_invalid")
	}
	userEndpoint := "https://api.weixin.qq.com/sns/userinfo?" + url.Values{
		"access_token": []string{tokenBody.AccessToken},
		"openid":       []string{tokenBody.OpenID},
		"lang":         []string{"zh_CN"},
	}.Encode()
	userResp, err := common.Get(ctx, userEndpoint, nil)
	if err != nil {
		return nil, err
	}
	if userResp.StatusCode >= http.StatusBadRequest {
		return nil, errors.New("weixin_userinfo_failed")
	}
	var userBody map[string]any
	if err := common.DecodeJSON(userResp, &userBody); err != nil {
		return nil, err
	}
	nickname, _ := userBody["nickname"].(string)
	headimgurl, _ := userBody["headimgurl"].(string)
	unionID, _ := userBody["unionid"].(string)
	if unionID == "" {
		unionID = tokenBody.UnionID
	}
	return &port.ProviderIdentity{
		ProviderUserID: tokenBody.OpenID,
		UnionID:        unionID,
		Username:       nickname,
		DisplayName:    nickname,
		AvatarURL:      headimgurl,
		Raw:            userBody,
	}, nil
}
