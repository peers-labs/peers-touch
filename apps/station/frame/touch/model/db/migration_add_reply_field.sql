-- Migration: Add Reply field to touch_ap_activity table
-- Date: 2025-12-31
-- Purpose: Add explicit Reply boolean field to distinguish replies from posts (following Mastodon's approach)

-- Step 1: Add the Reply column if it doesn't exist (GORM AutoMigrate will handle this)
-- This is just for manual migration if needed
-- ALTER TABLE touch_ap_activity ADD COLUMN IF NOT EXISTS reply BOOLEAN NOT NULL DEFAULT false;

-- Step 2: Create index on Reply field for efficient filtering
CREATE INDEX IF NOT EXISTS idx_touch_ap_activity_reply ON touch_ap_activity(reply);

-- Step 3: Update existing records - set Reply=true for all activities where InReplyTo is not 0
UPDATE touch_ap_activity 
SET reply = true 
WHERE in_reply_to != 0 AND reply = false;

-- Step 4: Create composite index for efficient outbox queries (excluding replies)
-- This index helps filter out replies when fetching user's main posts
CREATE INDEX IF NOT EXISTS idx_touch_ap_activity_actor_public_reply 
ON touch_ap_activity(actor_id, is_public, reply, published DESC)
WHERE type = 'Create' AND reply = false;

-- Verification queries:
-- SELECT COUNT(*) FROM touch_ap_activity WHERE reply = true;
-- SELECT COUNT(*) FROM touch_ap_activity WHERE in_reply_to != 0;
-- SELECT * FROM touch_ap_activity WHERE in_reply_to != 0 AND reply = false LIMIT 10;
