package infrastructure

import (
	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"gorm.io/gorm"
)

// Follow rows are authoritative at the subscriber Home Station. At the author
// Station, remote followers come from the authenticated subscription receiver,
// not a second writable follow graph. Publish and read use the same predicates.
func privateLocalFollowerQuery(database *gorm.DB) *gorm.DB {
	return database.Table("follows AS follow").
		Joins("JOIN touch_actor AS follower ON follower.id = follow.follower_id").
		Joins("JOIN touch_actor AS owner ON owner.id = follow.following_id").
		Where("follower.home_station_peer_id = owner.home_station_peer_id")
}

func privateRemoteFollowerQuery(database *gorm.DB) *gorm.DB {
	return database.Table("social_feed_subscriptions AS subscription").
		Joins("JOIN touch_actor AS owner ON owner.ptid = subscription.author_ptid").
		Joins("JOIN touch_actor AS follower ON follower.ptid = subscription.subscriber_ptid").
		Where(
			"subscription.chain_id = ? AND subscription.enabled = ? AND subscription.revision > 0",
			socialdomain.PublicFeedChainID, true,
		).
		Where(
			"subscription.author_station = owner.home_station_peer_id AND " +
				"subscription.subscriber_station = follower.home_station_peer_id AND " +
				"subscription.author_station <> subscription.subscriber_station AND " +
				"subscription.author_station <> '' AND subscription.subscriber_station <> ''",
		)
}
