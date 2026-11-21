/** Master switch for license gating. Off = every feature is free for
 *  everyone; the License page stays visible and a key only provisions the
 *  fixed per-license tunnel URL. On = /v1/*, MCP and the bot need a key.
 *  Safe to import from client components (no node APIs here). */
export const LICENSE_REQUIRED = false;
