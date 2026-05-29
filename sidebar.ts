/**
 * Sidebar Extension — Crush-style right panel
 *
 * Shows: model info, todo list, session stats
 * Uses ctx.ui.custom() with overlay mode
 *
 * Commands:
 *   /sidebar — toggle sidebar visibility
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";

interface Todo {
  id: number;
  text: string;
  done: boolean;
}

interface TodoDetails {
  todos: Todo[];
}

const SIDEBAR_WIDTH = 30;

export default function (pi: ExtensionAPI) {
  let sidebarVisible = true;
  let overlayHandle: any = null;
  let todos: Todo[] = [];
  let ctxRef: ExtensionContext | null = null;

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

  function buildSidebar(theme: any, width: number): string[] {
    const lines: string[] = [];
    const w = width - 2;

    lines.push(theme.fg("accent", "─".repeat(w)));
    lines.push(theme.fg("text", theme.bold("  Session")));
    lines.push(theme.fg("accent", "─".repeat(w)));
    lines.push("");

    const model = ctxRef?.model;
    if (model) {
      lines.push(theme.fg("muted", "  Model ") + theme.fg("text", model.name || model.id));
    }

    const thinking = ctxRef?.getThinkingLevel?.();
    if (thinking) {
      lines.push(theme.fg("muted", "  Think  ") + theme.fg("text", thinking));
    }

    const usage = ctxRef?.getContextUsage?.();
    if (usage) {
      const pct = Math.round(usage.percentage || 0);
      const bar = buildMiniBar(pct, 15);
      lines.push(theme.fg("muted", "  Ctx    ") + bar + ` ${pct}%`);
    }

    lines.push("");
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

      const pending = todos.filter((t) => !t.done);
      const completed = todos.filter((t) => t.done);

      for (const t of pending.slice(0, 8)) {
        lines.push(`  ${theme.fg("dim", "•")} ${theme.fg("text", truncate(t.text, w - 6))}`);
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
    return "█".repeat(filled) + "░".repeat(width - filled);
  }

  function truncate(s: string, max: number): string {
    return s.length <= max ? s : s.slice(0, max - 1) + "…";
  }

  function showSidebar(ctx: ExtensionContext) {
    if (!sidebarVisible) return;

    const content = buildSidebar(ctx.ui.theme, SIDEBAR_WIDTH);

    // Use custom() with overlay mode
    ctx.ui.custom(
      (tui, theme) => {
        const container = new Container();
        for (const line of content) {
          container.addChild(new Text(line, 0, 0));
        }
        return container;
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: "right-center",
          width: SIDEBAR_WIDTH,
          maxHeight: "90%",
          margin: { top: 1, right: 1, bottom: 1, left: 0 },
        },
        onHandle: (handle) => {
          overlayHandle = handle;
        },
      },
    );
  }

  // ── Events ────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    ctxRef = ctx;
    reconstructTodos(ctx);
    // Delay sidebar show to avoid conflict with initial render
    setTimeout(() => showSidebar(ctx), 1000);
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName === "todo") {
      const details = event.result?.details as TodoDetails | undefined;
      if (details?.todos) {
        todos = details.todos;
      }
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    ctxRef = ctx;
    if (overlayHandle && sidebarVisible) {
      overlayHandle.setHidden(false);
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
        showSidebar(ctx);
      }
      ctx.ui.notify(sidebarVisible ? "Sidebar shown" : "Sidebar hidden", "info");
    },
  });
}
