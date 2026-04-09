/**
 * Module registrations.
 * Import this file once (in main.tsx) to trigger all self-registrations.
 */
import './providers';
import './model-service';
import './tts';
import './account';
import './skills';
import './mcp';
import './channels';
import './cron';
import './memory';
import './applets';
import './logs';
import './connections';

// OAuth settings split:
// - OAuth Sign-In: account login flow for supported providers
// - Advanced Connections: client credential management for private beta users
