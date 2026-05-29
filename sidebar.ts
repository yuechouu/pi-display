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
  let gitFiles: { name: string; additions: number; deletions: number }[] = [];

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

  async function refreshGitBranch(ctx: ExtensionContext) {
    try {
      const result = await pi.exec("git", ["branch", "--show-current"], { timeout: 3000 });
      gitBranch = result.stdout.trim() || "";
    } catch {
      gitBranch = "";
    }
  }

  async function refreshGitFiles() {
    try {
      const result = await pi.exec("git", ["diff", "--numstat", "HEAD"], { timeout: 3000 });
      gitFiles = result.stdout.trim().split("\n").filter(Boolean).map(line => {
        const [add, del, name] = line.split("\t");
        return { name, additions: parseInt(add) || 0, deletions: parseInt(del) || 0 };
      }).slice(0, 10);
    } catch {
      gitFiles = [];
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

    if (gitFiles.length > 0) {
      line();
      sp();
      c.addChild(new Text(section(`  Files ${muted(`(${gitFiles.length})`)}`), 0, 0));
      sp();
      for (const f of gitFiles) {
        const add = f.additions > 0 ? dim(`+${f.additions}`) : "";
        const del = f.deletions > 0 ? dim(` -${f.deletions}`) : "";
        const stats = add || del ? ` ${add}${del}` : "";
        c.addChild(new Text(`  ${text(trunc(f.name, W - 8))}${stats}`, 0, 0));
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
    reconstructTodos(ctx);
    await refreshGitBranch(ctx);
    await refreshGitFiles();
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
    await refreshGitFiles();
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
