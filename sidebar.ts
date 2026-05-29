/**
 * Sidebar Extension — Crush-style right panel
 *
 * Shows: model info, todo list, session stats
 * Uses overlay system to render on the right side
 *
 * Commands:
 *   /sidebar — toggle sidebar visibility
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

interface Todo {
  id: number;
  text: string;
  done: boolean;
}

interface TodoDetails {
  todos: Todo[];
}

interface OverlayHandle {
  hide(): void;
  setHidden(hidden: boolean): void;
}

const SIDEBAR_WIDTH = 30;

export default function (pi: ExtensionAPI) {
  let sidebarVisible = true;
  let overlayHandle: OverlayHandle | null = null;
  let todos: Todo[] = [];
  let ctxRef: ExtensionContext | null = null;

  // Reconstruct todo state
  function reconstructTodos(ctx: ExtensionContext) {
    todos = [];
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg.role !== "toolResult" || msg.toolName !== "todo") continue;
      const details = msg.details as TodoDetails | undefined;
      if (details?.todos) {
        todos = details.todos;
      }
    }
  }

  // Build sidebar content
  function buildSidebar(theme: any, width: number): string[] {
    const lines: string[] = [];
    const w = width - 2; // padding

    // Header
    lines.push(theme.fg("accent", "─".repeat(w)));
    lines.push(theme.fg("text", theme.bold("  Session Info")));
    lines.push(theme.fg("accent", "─".repeat(w)));
    lines.push("");

    // Model info
    const model = ctxRef?.model;
    if (model) {
      lines.push(theme.fg("muted", "  Model ") + theme.fg("text", model.name || model.id));
    }

    // Thinking level
    const thinking = ctxRef?.getThinkingLevel?.();
    if (thinking) {
      lines.push(theme.fg("muted", "  Think  ") + theme.fg("text", thinking));
    }

    // Context usage
    const usage = ctxRef?.getContextUsage?.();
    if (usage) {
      const pct = Math.round(usage.percentage || 0);
      const bar = buildMiniBar(pct, 15);
      lines.push(theme.fg("muted", "  Ctx    ") + bar + ` ${pct}%`);
    }

    lines.push("");

    // Todo section
    lines.push(theme.fg("accent", "─".repeat(w)));
    lines.push(theme.fg("text", theme.bold("  Tasks")));
    lines.push(theme.fg("accent", "─".repeat(w)));
    lines.push("");

    if (todos.length === 0) {
      lines.push(theme.fg("dim", "  No tasks"));
    } else {
      const done = todos.filter((t) => t.done).length;
      const total = todos.length;
      const pct = Math.round((done / total) * 100);
      lines.push(theme.fg("muted", `  ${done}/${total} `) + buildMiniBar(pct, 10) + ` ${pct}%`);
      lines.push("");

      // Show pending tasks
      const pending = todos.filter((t) => !t.done);
      const completed = todos.filter((t) => t.done);

      for (const t of pending.slice(0, 8)) {
        const icon = theme.fg("dim", "•");
        const text = theme.fg("text", truncate(t.text, w - 6));
        lines.push(`  ${icon} ${text}`);
      }

      if (pending.length > 8) {
        lines.push(theme.fg("dim", `  ... ${pending.length - 8} more`));
      }

      if (completed.length > 0) {
        lines.push("");
        lines.push(theme.fg("dim", `  ✓ ${completed.length} completed`));
      }
    }

    lines.push("");
    lines.push(theme.fg("accent", "─".repeat(w)));

    return lines;
  }

  function buildMiniBar(percent: number, width: number): string {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return "█".repeat(filled) + "░".repeat(empty);
  }

  function truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + "…";
  }

  // Update or create sidebar overlay
  function updateSidebar(ctx: ExtensionContext) {
    if (!sidebarVisible) {
      if (overlayHandle) {
        overlayHandle.setHidden(true);
      }
      return;
    }

    const content = buildSidebar(ctx.ui.theme, SIDEBAR_WIDTH);

    if (!overlayHandle) {
      overlayHandle = ctx.ui.showOverlay(
        (tui, theme) => {
          const { Text, Container } = require("@earendil-works/pi-tui");
          const container = new Container();
          for (const line of content) {
            container.addChild(new Text(line, 0, 0));
          }
          return container;
        },
        {
          anchor: "right-center",
          width: SIDEBAR_WIDTH,
          nonCapturing: true,
          margin: { top: 1, right: 1, bottom: 1, left: 0 },
        },
      );
    } else {
      overlayHandle.setHidden(false);
    }
  }

  // ── Events ────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    ctxRef = ctx;
    reconstructTodos(ctx);
    updateSidebar(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    ctxRef = ctx;
    updateSidebar(ctx);
  });

  // Listen for todo changes
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName === "todo") {
      const details = event.result?.details as TodoDetails | undefined;
      if (details?.todos) {
        todos = details.todos;
        updateSidebar(ctx);
      }
    }
  });

  // ── Commands ──────────────────────────────────────────────

  pi.registerCommand("sidebar", {
    description: "Toggle sidebar visibility",
    handler: async (_args, ctx) => {
      sidebarVisible = !sidebarVisible;
      if (overlayHandle) {
        overlayHandle.setHidden(!sidebarVisible);
      } else if (sidebarVisible) {
        updateSidebar(ctx);
      }
      ctx.ui.notify(sidebarVisible ? "Sidebar shown" : "Sidebar hidden", "info");
    },
  });
}
