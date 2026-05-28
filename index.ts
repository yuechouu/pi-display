/**
 * Pi Display Extension
 *
 * Overrides built-in tool renderers for a cleaner, Claude Code inspired look.
 * - bash: clean command display, no green, compact output
 * - edit: cleaner diff display
 * - read: minimal header
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text, Container } from "@earendil-works/pi-tui";

export default function (pi: ExtensionAPI) {
  // We can't directly override renderCall/renderResult of built-in tools
  // without reimplementing execute. Instead, we use tool_result to post-process
  // and the theme to control colors.

  // The theme file (claude-code-theme.json) handles the color changes.
  // This extension adds a status bar showing tool execution info cleanly.

  let toolStartTime = 0;

  pi.on("tool_execution_start", async (event, ctx) => {
    toolStartTime = Date.now();
    const theme = ctx.ui.theme;
    const name = theme.fg("dim", event.toolName);
    ctx.ui.setStatus("display-tool", theme.fg("dim", "▸ ") + name);
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    const elapsed = Date.now() - toolStartTime;
    const theme = ctx.ui.theme;
    const ms = elapsed > 1000 ? `${(elapsed / 1000).toFixed(1)}s` : `${elapsed}ms`;
    const name = theme.fg("text", event.toolName);
    const time = theme.fg("dim", ` (${ms})`);
    ctx.ui.setStatus("display-tool", theme.fg("success", "✓ ") + name + time);

    // Clear after 3 seconds
    setTimeout(() => {
      ctx.ui.setStatus("display-tool", "");
    }, 3000);
  });

  // Register a /theme command to apply the claude-code theme
  pi.registerCommand("theme", {
    description: "Switch to Claude Code theme or show current theme info",
    argumentHint: "[claude-code|default]",
    handler: async (args, ctx) => {
      const target = args.trim().toLowerCase();
      if (target === "claude-code" || target === "cc") {
        ctx.ui.notify(
          "To apply the Claude Code theme, copy claude-code-theme.json to:\n" +
          "  ~/.pi/agent/themes/claude-code.json\n" +
          "Then set \"theme\": \"claude-code\" in ~/.pi/agent/settings.json",
          "info"
        );
      } else {
        ctx.ui.notify("Usage: /theme claude-code — apply Claude Code inspired theme", "info");
      }
    },
  });
}
