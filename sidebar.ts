/**
 * Sidebar Extension — Crush-style right panel
 *
 * Uses ctx.ui.setSidebar() for a persistent overlay on the right side.
 * Shows: session info, model, context, git, tasks, tools
 *
 * Commands:
 *   /sidebar — toggle visibility
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

const W = 28; // inner width

export default function (pi: ExtensionAPI) {
  let visible = true;
  let todos: Todo[] = [];
  let ctxRef: ExtensionContext | null = null;
  let currentMode = "coding";
  let gitBranch = "";

  // ── Todo state ──────────────────────────────────────────

  function reconstructTodos(ctx: ExtensionContext) {
    todos = [];
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg.role !== "toolResult" || msg.toolName !== "todo") continue;
      const details = msg.details as TodoDetails | undefined;
      if (details?.todos) todos = details.todos;
    }
  }

  // ── Git branch ──────────────────────────────────────────

  async function refreshGitBranch(ctx: ExtensionContext) {
    try {
      const result = await pi.exec("git", ["branch", "--show-current"], { timeout: 3000 });
      gitBranch = result.stdout.trim() || "";
    } catch {
      gitBranch = "";
    }
  }

  // ── Session cost ────────────────────────────────────────

  function computeSessionCost(ctx: ExtensionContext): number {
    let cost = 0;
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg.role === "assistant" && msg.usage?.cost?.total) {
        cost += msg.usage.cost.total;
      }
    }
    return cost;
  }

  // ── Build sidebar ───────────────────────────────────────

  function build(theme: any): Container {
    const c = new Container();
    const sep = theme.fg("dim", "─".repeat(W));
    const label = (s: string) => theme.fg("muted", `  ${s}  `);
    const value = (s: string) => theme.fg("text", s);

    // ── Header ──
    c.addChild(new Text(sep, 0, 0));
    c.addChild(new Text(theme.fg("accent", theme.bold("  PI")), 0, 0));
    c.addChild(new Text(sep, 0, 0));
    c.addChild(new Text("", 0, 0));

    // ── Session ──
    const sessionName = ctxRef?.sessionManager.getSessionName?.();
    if (sessionName) c.addChild(new Text(label("Session") + value(sessionName), 0, 0));

    const cwd = ctxRef?.cwd || "";
    if (cwd) {
      const home = process.env.HOME || process.env.USERPROFILE || "";
      const prettyCwd = cwd.replace(home, "~").replace(/\\/g, "/");
      c.addChild(new Text(label("Cwd    ") + value(prettyCwd), 0, 0));
    }

    if (gitBranch) c.addChild(new Text(label("Branch ") + value(gitBranch), 0, 0));

    const mode = currentMode;
    c.addChild(new Text(label("Mode   ") + value(mode), 0, 0));
    c.addChild(new Text("", 0, 0));

    // ── Model ──
    c.addChild(new Text(sep, 0, 0));
    c.addChild(new Text(theme.fg("accent", theme.bold("  Model")), 0, 0));
    c.addChild(new Text(sep, 0, 0));
    c.addChild(new Text("", 0, 0));

    const model = ctxRef?.model;
    if (model) {
      c.addChild(new Text(label("Name   ") + value(model.name || model.id), 0, 0));
      if (model.provider) c.addChild(new Text(label("Provider") + value(model.provider), 0, 0));
    }

    const thinking = ctxRef?.getThinkingLevel?.();
    if (thinking) c.addChild(new Text(label("Think  ") + value(thinking), 0, 0));

    const usage = ctxRef?.getContextUsage?.();
    if (usage) {
      const pct = usage.percent ?? Math.round(((usage.tokens || 0) / usage.contextWindow) * 100);
      const bar = miniBar(pct, 12);
      c.addChild(new Text(label("Ctx    ") + bar + ` ${pct}%`, 0, 0));
    }

    const cost = ctxRef ? computeSessionCost(ctxRef) : 0;
    if (cost > 0) c.addChild(new Text(label("Cost   ") + value(`$${cost.toFixed(3)}`), 0, 0));
    c.addChild(new Text("", 0, 0));

    // ── Tasks ──
    c.addChild(new Text(sep, 0, 0));
    c.addChild(new Text(theme.fg("accent", theme.bold("  Tasks")), 0, 0));
    c.addChild(new Text(sep, 0, 0));
    c.addChild(new Text("", 0, 0));

    if (todos.length === 0) {
      c.addChild(new Text(theme.fg("dim", "  No tasks"), 0, 0));
    } else {
      const done = todos.filter((t) => t.done).length;
      const total = todos.length;
      const pct = Math.round((done / total) * 100);
      c.addChild(new Text(`  ${value(`${done}/${total}`)} ${miniBar(pct, 10)} ${pct}%`, 0, 0));
      c.addChild(new Text("", 0, 0));

      const pending = todos.filter((t) => !t.done);
      const completed = todos.filter((t) => t.done);

      for (const t of pending.slice(0, 6)) {
        c.addChild(new Text(`  ${theme.fg("dim", "•")} ${value(trunc(t.text, W - 5))}`, 0, 0));
      }
      if (pending.length > 6) c.addChild(new Text(theme.fg("dim", `  ... ${pending.length - 6} more`), 0, 0));
      if (completed.length > 0) {
        c.addChild(new Text("", 0, 0));
        c.addChild(new Text(theme.fg("dim", `  ✓ ${completed.length} completed`), 0, 0));
      }
    }
    c.addChild(new Text("", 0, 0));

    // ── Tools ──
    c.addChild(new Text(sep, 0, 0));
    c.addChild(new Text(theme.fg("accent", theme.bold("  Tools")), 0, 0));
    c.addChild(new Text(sep, 0, 0));
    c.addChild(new Text("", 0, 0));

    try {
      const tools = pi.getActiveTools();
      c.addChild(new Text(`  ${value(tools.join(" "))}`, 0, 0));
    } catch {
      c.addChild(new Text(theme.fg("dim", "  (unavailable)"), 0, 0));
    }

    c.addChild(new Text("", 0, 0));
    c.addChild(new Text(sep, 0, 0));
    return c;
  }

  // ── Helpers ─────────────────────────────────────────────

  function miniBar(pct: number, w: number): string {
    const filled = Math.round((pct / 100) * w);
    return "█".repeat(filled) + "░".repeat(w - filled);
  }

  function trunc(s: string, max: number): string {
    return s.length <= max ? s : s.slice(0, max - 1) + "…";
  }

  function refresh(ctx: ExtensionContext) {
    if (!visible) {
      ctx.ui.setSidebar(undefined);
      return;
    }
    ctx.ui.setSidebar((_tui, theme) => build(theme), { width: W + 4 });
  }

  // ── Events ──────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    ctxRef = ctx;
    reconstructTodos(ctx);
    await refreshGitBranch(ctx);
    setTimeout(() => refresh(ctx), 300);
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName === "todo") {
      const details = event.result?.details as TodoDetails | undefined;
      if (details?.todos) todos = details.todos;
      refresh(ctx);
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    ctxRef = ctx;
    await refreshGitBranch(ctx);
    refresh(ctx);
  });

  // Listen for mode changes
  pi.events.on("mode_changed", ({ mode }: { mode: string }) => {
    currentMode = mode;
    if (ctxRef) refresh(ctxRef);
  });

  // ── Commands ────────────────────────────────────────────

  pi.registerCommand("sidebar", {
    description: "Toggle sidebar visibility",
    handler: async (_args, ctx) => {
      visible = !visible;
      refresh(ctx);
      ctx.ui.notify(visible ? "Sidebar shown" : "Sidebar hidden", "info");
    },
  });
}
