package provisioning

import (
	"context"
	"net/http"
	"strings"
	"time"
)

// botResult is the internal creation result including the secret; only the
// non-secret BotSummary is exposed to poll responses.
type botResult struct {
	appID               string
	appSecret           string
	appName             string
	ownerProviderUserID string
	online              bool
}

func (r botResult) summary(openBase string) *BotSummary {
	return &BotSummary{
		AppID:               r.appID,
		AppName:             r.appName,
		ConsoleURL:          strings.TrimRight(openBase, "/") + "/app/" + r.appID,
		OwnerProviderUserID: r.ownerProviderUserID,
		PublishedOnline:     r.online,
	}
}

// createBotWithClient runs the full developer-console setup with an
// authenticated client (jar already holding the QR-login session cookies).
func createBotWithClient(
	ctx context.Context,
	cfg Config,
	httpc *http.Client,
	appName, appDescription string,
) (*botResult, error) {
	appName = strings.TrimSpace(appName)
	if appName == "" {
		appName = cfg.DefaultAppName
	}
	if appName == "" {
		appName = "Peers Assistant"
	}
	appDescription = strings.TrimSpace(appDescription)
	if appDescription == "" {
		appDescription = "Personal AI assistant"
	}
	establishWS := cfg.wsEstablish
	if establishWS == nil {
		establishWS = sdkWSEstablisher(0, cfg.WSBase)
	}
	consoleSleep := cfg.consoleSleep
	if consoleSleep == nil {
		consoleSleep = time.Sleep
	}
	dev := newDeveloperClient(cfg.OpenBase, httpc)
	dev.establishWS = establishWS
	dev.sleep = consoleSleep
	if err := dev.fetchCSRF(ctx); err != nil {
		return nil, err
	}

	appID, err := dev.findApp(ctx, appName)
	if err != nil {
		return nil, err
	}
	if appID == "" {
		appID, err = dev.createApp(ctx, appName, appDescription)
		if err != nil {
			return nil, err
		}
	}
	secret, err := dev.getAppSecret(ctx, appID)
	if err != nil {
		return nil, err
	}
	if err := dev.enableBot(ctx, appID); err != nil {
		return nil, err
	}
	if err := dev.importScopes(ctx, appID); err != nil {
		return nil, err
	}
	if err := dev.setLongConnection(ctx, appID, secret); err != nil {
		return nil, err
	}
	if err := dev.subscribePrivateMessage(ctx, appID); err != nil {
		return nil, err
	}

	outcome, ownerProviderUserID, err := dev.publish(ctx, appID)
	if err != nil {
		return nil, err
	}
	return &botResult{
		appID:               appID,
		appSecret:           secret,
		appName:             appName,
		ownerProviderUserID: ownerProviderUserID,
		online:              outcome == publishOnline,
	}, nil
}
