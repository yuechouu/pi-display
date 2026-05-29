/**
 * Sidebar Extension — Crush-style right panel (clean, no separator lines)
 *
 * Uses ctx.ui.setSidebar() for a proper two-column layout.
 * Shows: session info, model, context, tasks, tools
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

const W = 28;

export default function (pi: ExtensionAPI) {
  let visible = true;
  let todos: Todo[] = [];
  let ctxRef: ExtensionContext | null = null;
  let currentMode = "coding";
  let gitBranch = "";
  let sessionFiles: Map<string, { tool: string; count: number }> = new Map();

  function reconstructState(ctx: ExtensionContext) {
    todos = [];
    sessionFiles = new Map();

    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message;

      // Track todos
      if (msg.role === "toolResult" && msg.toolName === "todo") {
        const details = msg.details as TodoDetails | undefined;
        if (details?.todos) todos = details.todos;
      }

      // Track files from tool calls
      if (msg.role === "toolResult" && msg.toolName) {
        const tool = msg.toolName;
        if (["edit", "write", "read"].includes(tool)) {
          // Extract file path from tool call args
          const args = (msg as any).toolInput || {};
          const filePath = args.path || args.file_path || "";
          if (filePath) {
            const name = filePath.split(/[/\\]/).pop() || filePath;
            const existing = sessionFiles.get(name);
            if (existing) {
              existing.count++;
            } else {
              sessionFiles.set(name, { tool, count: 1 });
            }
          }
        }
      }
    }
  }

  async function refreshGitBranch(ctx: ExtensionContext) {
    try {
      const result = await pi.exec("git", ["branch", "--show-current"], { timeout: 3000 });
      gitBranch = result.stdout.trim() || "";
    } catch {
      gitBranch = "";
    }
  }


  function computeSessionCost(ctx: ExtensionContext): number {
    let cost = 0;
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg.role === "assistant" && msg.usage?.cost?.total) cost += msg.usage.cost.total;
    }
    return cost;
  }

  function build(theme: any): Container {
    const c = new Container();
    const dim = (s: string) => theme.fg("dim", s);
    const muted = (s: string) => theme.fg("muted", s);
    const text = (s: string) => theme.fg("text", s);
    const section = (s: string) => theme.fg("accent", theme.bold(s));
    const line = () => c.addChild(new Text(dim("  " + "─".repeat(W - 2)), 0, 0));
    const sp = () => c.addChild(new Text("", 0, 0));

    // ── Header ──
    c.addChild(new Text(section("  PI"), 0, 0));
    line();
    sp();

    // ── Session ──
    c.addChild(new Text(section("  Session"), 0, 0));
    sp();

    const sessionName = ctxRef?.sessionManager.getSessionName?.();
    if (sessionName) c.addChild(new Text(`  ${muted("name")}  ${text(sessionName)}`, 0, 0));

    const cwd = ctxRef?.cwd || "";
    if (cwd) {
      const home = process.env.HOME || process.env.USERPROFILE || "";
      c.addChild(new Text(`  ${muted("cwd")}   ${text(cwd.replace(home, "~").replace(/\\/g, "/"))}`, 0, 0));
    }

    if (gitBranch) c.addChild(new Text(`  ${muted("git")}   ${text(gitBranch)}`, 0, 0));
    c.addChild(new Text(`  ${muted("mode")}  ${text(currentMode)}`, 0, 0));

    if (sessionFiles.size > 0) {
      line();
      sp();
      c.addChild(new Text(section(`  Files ${muted(`(${sessionFiles.size})`)}`), 0, 0));
      sp();
      for (const [name, info] of sessionFiles) {
        const toolIcon = info.tool === "edit" ? "✎" : info.tool === "write" ? "✓" : "○";
        c.addChild(new Text(`  ${dim(toolIcon)} ${text(trunc(name, W - 6))}`, 0, 0));
      }
    }

    line();
    sp();

    // ── Model ──
    c.addChild(new Text(section("  Model"), 0, 0));
    sp();

    const model = ctxRef?.model;
    if (model) {
      c.addChild(new Text(`  ${text(model.name || model.id)}`, 0, 0));
      if (model.provider) c.addChild(new Text(`  ${muted(model.provider)}`, 0, 0));
    }

    const thinking = ctxRef?.getThinkingLevel?.();
    if (thinking) c.addChild(new Text(`  ${muted("think")} ${text(thinking)}`, 0, 0));

    const usage = ctxRef?.getContextUsage?.();
    if (usage) {
      const pct = usage.percent ?? Math.round(((usage.tokens || 0) / usage.contextWindow) * 100);
      c.addChild(new Text(`  ${muted("ctx")}   ${miniBar(pct, 10)} ${text(`${pct}%`)}`, 0, 0));
    }

    const cost = ctxRef ? computeSessionCost(ctxRef) : 0;
    if (cost > 0) c.addChild(new Text(`  ${muted("cost")}  ${text(`$${cost.toFixed(3)}`)}`, 0, 0));

    line();
    sp();

    // ── Tasks ──
    c.addChild(new Text(section("  Tasks"), 0, 0));
    sp();

    if (todos.length > 0) {
      const done = todos.filter((t) => t.done).length;
      const total = todos.length;
      const pct = Math.round((done / total) * 100);

      c.addChild(new Text(`  ${muted(`${done}/${total}`)} ${miniBar(pct, 10)} ${text(`${pct}%`)}`, 0, 0));
      sp();

      const pending = todos.filter((t) => !t.done);
      for (const t of pending.slice(0, 5)) {
        c.addChild(new Text(`  ${dim("•")} ${text(trunc(t.text, W - 5))}`, 0, 0));
      }
      if (pending.length > 5) c.addChild(new Text(`  ${dim(`+${pending.length - 5} more`)}`, 0, 0));

      const completed = todos.filter((t) => t.done);
      if (completed.length > 0) {
        sp();
        c.addChild(new Text(`  ${dim(`✓ ${completed.length} done`)}`, 0, 0));
      }
    } else {
      c.addChild(new Text(`  ${dim("no tasks")}`, 0, 0));
    }

    line();
    sp();

    // ── Tools ──
    c.addChild(new Text(section("  Tools"), 0, 0));
    sp();

    try {
      const tools = pi.getActiveTools();
      // Wrap tool names into lines that fit
      let line = "  ";
      for (const tool of tools) {
        if (line.length + tool.length + 1 > W) {
          c.addChild(new Text(muted(line), 0, 0));
          line = "  ";
        }
        line += (line === " " ? "" : " ") + tool;
      }
      if (line.trim()) c.addChild(new Text(muted(line), 0, 0));
    } catch {
      c.addChild(new Text(`  ${dim("(unavailable)")}`, 0, 0));
    }

    c.addChild(new Text("", 0, 0));
    return c;
  }

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
    reconstructState(ctx);
    await refreshGitBranch(ctx);
    setTimeout(() => refresh(ctx), 300);
  });

  pi.on("tool_result", async (event, ctx) => {
    // Track todos
    if (event.toolName === "todo") {
      const details = event.result?.details as TodoDetails | undefined;
      if (details?.todos) todos = details.todos;
    }

    // Track files from edit/write/read
    if (["edit", "write", "read"].includes(event.toolName)) {
      const args = (event as any).input || {};
      const filePath = args.path || args.file_path || "";
      if (filePath) {
        const name = filePath.split(/[/\\]/).pop() || filePath;
        const existing = sessionFiles.get(name);
        if (existing) {
          existing.count++;
        } else {
          sessionFiles.set(name, { tool: event.toolName, count: 1 });
        }
      }
    }

    refresh(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    ctxRef = ctx;
    reconstructState(ctx);
    await refreshGitBranch(ctx);
    refresh(ctx);
  });

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
