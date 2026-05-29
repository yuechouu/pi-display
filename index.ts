/**
 * Pi Display Extension
 *
 * Overrides built-in tool renderers for Claude Code style display.
 * - edit: Claude Code style diff (● path ⎿ summary + diff)
 * - bash: clean command display
 * - tool execution status bar
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text, Container } from "@earendil-works/pi-tui";

export default function (pi: ExtensionAPI) {

  // ── Tool execution status bar ────────────────────────────

  let toolStartTime = 0;

  pi.on("tool_execution_start", async (_event, ctx) => {
    toolStartTime = Date.now();
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    const elapsed = Date.now() - toolStartTime;
    const theme = ctx.ui.theme;
    const ms = elapsed > 1000 ? `${(elapsed / 1000).toFixed(1)}s` : `${elapsed}ms`;
    const name = theme.fg("text", event.toolName);
    const time = theme.fg("dim", ` (${ms})`);
    ctx.ui.setStatus("display-tool", theme.fg("success", "✓ ") + name + time);
    setTimeout(() => ctx.ui.setStatus("display-tool", ""), 3000);
  });
}
