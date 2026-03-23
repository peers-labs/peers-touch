/**
 * Applet Frontend Entry Point
 *
 * Import this file once (in main.tsx) to register all built-in applet frontends.
 * Each applet self-registers via the registry when its module is imported.
 *
 * To add a new applet's frontend:
 * 1. Create web/src/applets/<applet-id>/
 * 2. Implement Settings.tsx, Page.tsx, etc.
 * 3. Create index.ts that calls registerApplet()
 * 4. Add the import below
 */
import './web-search';
import './remote-cli';
import './agent-pilot';
