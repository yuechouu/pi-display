/**
 * Sidebar Extension — Crush-style info panel via footer
 *
 * Since pi's TUI is vertical-only (no columns), we use setFooter()
 * to display sidebar information at the bottom:
 *   Line 1: model, thinking, context usage
 *   Line 2: todo progress + pending tasks
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

export default function (pi: ExtensionAPI) {
  let sidebarVisible = true;
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

  function buildFooter(tui: any, theme: any, footerData: any) {
    const container = new Container();

    // Line 1: Model + Thinking + Context
    const model = ctxRef?.model;
    const thinking = ctxRef?.getThinkingLevel?.();
    const usage = ctxRef?.getContextUsage?.();

    let line1 = "";
    if (model) {
      line1 += theme.fg("accent", model.name || model.id);
    }
    if (thinking) {
      line1 += (line1 ? theme.fg("muted", " · ") : "") + theme.fg("text", `thinking: ${thinking}`);
    }
    if (usage) {
      const pct = Math.round(usage.percentage || 0);
      const bar = buildMiniBar(pct, 10);
      line1 += (line1 ? theme.fg("muted", " · ") : "") + bar + ` ${pct}%`;
    }

    // Add git branch and cwd from footerData
    const branch = footerData?.gitBranch;
    const cwd = footerData?.cwd;
    if (cwd) {
      line1 += (line1 ? theme.fg("muted", " · ") : "") + theme.fg("dim", cwd);
    }
    if (branch) {
      line1 += theme.fg("dim", ` (${branch})`);
    }

    if (line1) {
      container.addChild(new Text(line1, 0, 0));
    }

    // Line 2: Todo progress (if sidebar visible and has todos)
    if (sidebarVisible && todos.length > 0) {
      const done = todos.filter((t) => t.done).length;
      const total = todos.length;
      const pct = Math.round((done / total) * 100);

      let line2 = theme.fg("muted", "Tasks ") +
        theme.fg("text", `${done}/${total}`) +
        " " + buildMiniBar(pct, 10) +
        theme.fg("muted", ` ${pct}%`);

      // Show first 3 pending tasks
      const pending = todos.filter((t) => !t.done);
      if (pending.length > 0) {
        const preview = pending.slice(0, 3).map((t) => truncate(t.text, 20)).join(", ");
        line2 += theme.fg("muted", " · ") + theme.fg("text", preview);
        if (pending.length > 3) {
          line2 += theme.fg("dim", ` +${pending.length - 3}`);
        }
      }

      container.addChild(new Text(line2, 0, 0));
    }

    return container;
  }

  function buildMiniBar(percent: number, width: number): string {
    const filled = Math.round((percent / 100) * width);
    return "█".repeat(filled) + "░".repeat(width - filled);
  }

  function truncate(s: string, max: number): string {
    return s.length <= max ? s : s.slice(0, max - 1) + "…";
  }

  function updateFooter(ctx: ExtensionContext) {
    try {
      ctx.ui.setFooter((tui, theme, footerData) => {
        try {
          return buildFooter(tui, theme, footerData);
        } catch (e) {
          // Fallback: return a simple text component
          return new Text("Sidebar error: " + String(e), 0, 0);
        }
      });
    } catch (e) {
      // setFooter might not be available
      console.error("setFooter error:", e);
    }
  }

  // ── Events ────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    ctxRef = ctx;
    reconstructTodos(ctx);
    // Delay footer update to avoid conflict with initialization
    setTimeout(() => updateFooter(ctx), 500);
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName === "todo") {
      const details = event.result?.details as TodoDetails | undefined;
      if (details?.todos) {
        todos = details.todos;
        updateFooter(ctx);
      }
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    ctxRef = ctx;
    updateFooter(ctx);
  });

  // ── Commands ──────────────────────────────────────────────

  pi.registerCommand("sidebar", {
    description: "Toggle sidebar/todo info in footer",
    handler: async (_args, ctx) => {
      sidebarVisible = !sidebarVisible;
      updateFooter(ctx);
      ctx.ui.notify(sidebarVisible ? "Sidebar shown" : "Sidebar hidden", "info");
    },
  });
}
