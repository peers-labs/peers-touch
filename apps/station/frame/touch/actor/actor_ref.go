package actor

import (
	"fmt"
	"net"
	"net/url"
	"strings"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

// ProtoActorRef builds the canonical actor reference for API responses. baseURL may be
// empty (e.g. session verify) in which case acct is left empty; callers with an HTTP
// request should pass baseURLFrom.
func ProtoActorRef(a *db.Actor, baseURL string) *model.ActorRef {
	if a == nil {
		return nil
	}
	return &model.ActorRef{
		Ptid: a.PTID,
		Acct: acctFromBaseURL(a.PreferredUsername, baseURL),
		Kind: db.ActorKindFromShorthand(a.Kind),
	}
}

func acctFromBaseURL(preferredUsername, baseURL string) string {
	if strings.TrimSpace(preferredUsername) == "" || baseURL == "" {
		return ""
	}
	u, err := url.Parse(baseURL)
	if err != nil {
		return ""
	}
	host := u.Host
	if host == "" {
		return ""
	}
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	return fmt.Sprintf("%s@%s", preferredUsername, host)
}
