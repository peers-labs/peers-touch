//go:build social_acceptance

package social

import (
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
)

type feedAcceptanceRule struct {
	socialAcceptanceScope
	ID                  string `json:"id"`
	Actor               string `json:"actor"`
	SourceStation       string `json:"sourceStation"`
	MinimumHead         uint64 `json:"minimumHead"`
	IssuedMillis        int64  `json:"issuedMillis"`
	ExpiresMillis       int64  `json:"expiresMillis"`
	EffectCount         uint32 `json:"effectCount"`
	ObservedHead        uint64 `json:"observedHead"`
	FrameSHA256         string `json:"frameSha256"`
	RepairReads         uint32 `json:"repairReads"`
	RepairApplied       bool   `json:"repairApplied"`
	RepairAfterSequence uint64 `json:"repairAfterSequence"`
	RepairVerifiedHead  uint64 `json:"repairVerifiedHead"`
	MaxEvents           int    `json:"maxEvents"`
	MaxThreads          int    `json:"maxThreads"`
	MaxBytes            int    `json:"maxBytes"`
	Bounded             bool   `json:"bounded"`
}

type feedAcceptanceControl struct {
	scope socialAcceptanceScope
	root  string
	mu    sync.Mutex
}

func configureFeedAcceptance(service *application.FeedLogService, station string) error {
	scope, enabled, err := socialAcceptanceRuntimeScope(station)
	if err != nil || !enabled {
		return err
	}
	service.SetFederationObservation(&feedAcceptanceControl{
		scope: scope,
		root:  "/tmp/peers-social-acceptance-" + scope.RunID,
	})
	return nil
}

func (c *feedAcceptanceControl) DropNotification(actor, source string,
	head uint64, frameSHA256 string, now time.Time,
) bool {
	return c.update(now, func(rule *feedAcceptanceRule) bool {
		if rule.EffectCount != 0 || rule.Actor != actor ||
			rule.SourceStation != source || head < rule.MinimumHead ||
			len(frameSHA256) != 64 || strings.Trim(frameSHA256, "0123456789abcdef") != "" {
			return false
		}
		rule.EffectCount = 1
		rule.ObservedHead = head
		rule.FrameSHA256 = frameSHA256
		return true
	})
}

func (c *feedAcceptanceControl) ObserveRepair(actor, source string,
	afterSequence, verifiedHead uint64, events, threads, responseBytes int,
	applied bool, now time.Time,
) {
	c.update(now, func(rule *feedAcceptanceRule) bool {
		if rule.Actor != actor || rule.SourceStation != source || rule.EffectCount != 1 {
			return false
		}
		if rule.RepairReads != ^uint32(0) {
			rule.RepairReads++
		}
		rule.MaxEvents = max(rule.MaxEvents, events)
		rule.MaxThreads = max(rule.MaxThreads, threads)
		rule.MaxBytes = max(rule.MaxBytes, responseBytes)
		if applied && events > 0 && afterSequence < rule.ObservedHead &&
			verifiedHead >= rule.ObservedHead {
			if !rule.RepairApplied {
				rule.RepairAfterSequence = afterSequence
			}
			rule.RepairApplied = true
			rule.RepairVerifiedHead = max(rule.RepairVerifiedHead, verifiedHead)
		}
		rule.Bounded = rule.Bounded && events >= 0 && events <= 32 &&
			threads >= 0 && threads <= 32 && responseBytes >= 0 && responseBytes <= 1<<20
		return true
	})
}

func (c *feedAcceptanceControl) update(now time.Time,
	change func(*feedAcceptanceRule) bool,
) bool {
	if !c.scope.valid() {
		return false
	}
	var rule feedAcceptanceRule
	return updateSocialAcceptanceRule(c.root, &c.mu, &rule, func() bool {
		return rule.socialAcceptanceScope == c.scope && rule.ID != "" && len(rule.ID) <= 160 &&
			rule.Actor != "" && len(rule.Actor) <= 512 &&
			rule.SourceStation != "" && len(rule.SourceStation) <= 512 &&
			rule.MinimumHead != 0 && rule.EffectCount <= 1 &&
			socialAcceptanceLeaseValid(rule.IssuedMillis, rule.ExpiresMillis, now) &&
			change(&rule)
	})
}
