//go:build !social_acceptance

package social

import "github.com/peers-labs/peers-touch/station/app/subserver/social/application"

// Ordinary builds contain no local fault controller or control-file reader.
func configureFeedAcceptance(_ *application.FeedLogService, _ string) error {
	return nil
}
