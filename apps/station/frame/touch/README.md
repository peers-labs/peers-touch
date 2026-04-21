# TOUCH

TOUCH is the entrance of activitypub handler implementation and biz plugins storage place.

## Dictionary Description

- **actor**: The core processing logic of activityPub actor.

## Runtime Notes

- Actor presence is heartbeat-based (`touch_actor_status.last_heartbeat`) and a watchdog will mark stale actors offline.
