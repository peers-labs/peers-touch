package bootstrap

import (
	"errors"
	"os"
	"strings"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/interfaces/http/handler"
)

func LoadAdminAuthenticator() (*handler.BasicAuthenticator, error) {
	username := strings.TrimSpace(os.Getenv("OAUTH_ADMIN_USERNAME"))
	passwordHash := strings.TrimSpace(os.Getenv("OAUTH_ADMIN_PASSWORD_HASH"))
	production := strings.TrimSpace(os.Getenv("VERCEL")) != ""
	if username == "" && passwordHash == "" && !production {
		return nil, nil
	}
	if username == "" || passwordHash == "" {
		return nil, errors.New("admin_auth_configuration_required")
	}
	return handler.NewBasicAuthenticator(username, passwordHash, production)
}
