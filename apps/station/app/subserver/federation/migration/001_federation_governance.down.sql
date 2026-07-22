BEGIN;

DROP TABLE IF EXISTS federation_sync_cursor;
DROP TABLE IF EXISTS actor_signing_key;
DROP TABLE IF EXISTS federation_actor_role;
DROP TABLE IF EXISTS federation_station_membership;
DROP TABLE IF EXISTS federation_ledger_event;
DROP TABLE IF EXISTS federation;

COMMIT;
