//go:build !social_acceptance

package social

import (
	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
	"testing"
)

func TestPrivateAcceptanceOrdinaryBuildPreservesReceiver(t *testing.T) {
	t.Setenv("PT_SOCIAL_ACCEPTANCE_RUN_ID", "foreign")
	t.Setenv("PT_SOCIAL_ACCEPTANCE_PROFILE", "corpstable")
	receiver := &application.PrivateContentService{}
	actual, err := configurePrivateDeliveryAcceptance(receiver, "receiver")
	if err != nil || actual != receiver {
		t.Fatal("ordinary build installed a private fault controller")
	}
}
