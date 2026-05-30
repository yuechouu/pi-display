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
  let sessionFiles: Map<string, { tool: string; count: number; firstContent: string; latestContent: string; deleted?: boolean }> = new Map();
  let pendingToolPaths: Map<string, string> = new Map(); // toolCallId → filePath

  function reconstructState(ctx: ExtensionContext) {
    todos = [];
    sessionFiles = new Map();

    const entries = ctx.sessionManager.getEntries();

    // First pass: collect tool call args and results
    const toolCallArgs = new Map<string, any>(); // toolCallId → args
    const toolCallNames = new Map<string, string>(); // toolCallId → toolName

    for (const entry of entries) {
      if (entry.type !== "message") continue;
      const msg = entry.message;

      // Track todos
      if (msg.role === "toolResult" && msg.toolName === "todo") {
        const details = msg.details as TodoDetails | undefined;
        if (details?.todos) todos = details.todos;
      }

      // Collect tool call args from assistant messages
      if (msg.role === "assistant") {
        const content = (msg as any).content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "toolCall" && (block.name === "edit" || block.name === "write")) {
              const args = typeof block.arguments === "string"
                ? JSON.parse(block.arguments)
                : block.arguments || {};
              toolCallArgs.set(block.id, args);
              toolCallNames.set(block.id, block.name);
            }
          }
        }
      }

      // Match tool results with tool calls
      if (msg.role === "toolResult" && (msg.toolName === "edit" || msg.toolName === "write")) {
        const toolCallId = (msg as any).toolCallId;
        const args = toolCallArgs.get(toolCallId);

        if (args) {
          const filePath = args.path || args.file_path || "";
          if (filePath) {
            const content = args.content || "";
            addFile(filePath, msg.toolName, content);
          }
        }
      }

      // Track bash rm commands
      if (msg.role === "toolResult" && msg.toolName === "bash") {
        const toolCallId = (msg as any).toolCallId;
        const args = toolCallArgs.get(toolCallId);
        if (args?.command) {
          const cmd = args.command.trim();
          const rmMatch = cmd.match(/^rm\s+(?:-[rf]+\s+)?(.+)$/);
          if (rmMatch) {
            const paths = rmMatch[1].split(/\s+/);
            for (const p of paths) {
              const name = p.split(/[/\\]/).pop() || p;
              const existing = sessionFiles.get(name);
              if (existing) {
                existing.deleted = true;
              } else {
                sessionFiles.set(name, { tool: "bash", count: 1, firstContent: "", latestContent: "", deleted: true });
              }
            }
          }
        }
      }
    }
  }

  function addFile(filePath: string, tool: string, content: string) {
    const name = filePath.split(/[/\\]/).pop() || filePath;
    const existing = sessionFiles.get(name);
    if (existing) {
      existing.count++;
      existing.latestContent = content;
    } else {
      sessionFiles.set(name, { tool, count: 1, firstContent: content, latestContent: content });
    }
  }

  function computeDiff(first: string, latest: string): { additions: number; deletions: number } {
    if (!first && !latest) return { additions: 0, deletions: 0 };
    if (!first) return { additions: latest.split("\n").length, deletions: 0 };
    if (!latest) return { additions: 0, deletions: first.split("\n").length };
    const firstLines = new Set(first.split("\n"));
    const latestLines = new Set(latest.split("\n"));
    let additions = 0;
    let deletions = 0;
    for (const line of latestLines) {
      if (!firstLines.has(line)) additions++;
    }
    for (const line of firstLines) {
      if (!latestLines.has(line)) deletions++;
    }
    return { additions, deletions };
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
    const strikethrough = (s: string) => theme.strikethrough?.(s) ?? s;
    const section = (s: string) => theme.fg("accent", theme.bold(s));
    const line = () => c.addChild(new Text(dim("  " + "─".repeat(W - 2)), 0, 0));
    const sp = () => c.addChild(new Text("", 0, 0));

    // Count total content lines to compute spacing
    const sectionCount = 4; // Session, Files, Model, Tasks, Tools
    let totalContentLines = 0;
    totalContentLines += 3; // PI + line + Session header
    totalContentLines += 4; // name, cwd, git, mode
    const displayedFiles = Math.min(sessionFiles.size, 8);
    totalContentLines += sessionFiles.size > 0 ? displayedFiles + 2 + (sessionFiles.size > 8 ? 1 : 0) : 3; // Files
    totalContentLines += 5; // Model header + name + think + ctx + cost
    totalContentLines += todos.length > 0 ? Math.min(todos.filter(t => !t.done).length, 5) + 4 : 3; // Tasks
    totalContentLines += 3; // Tools header + content
    totalContentLines += sectionCount * 2; // lines between sections

    const termHeight = (process.stdout.rows || 40) - 2;
    const extraSpace = Math.max(0, termHeight - totalContentLines);
    const gapPerSection = Math.floor(extraSpace / sectionCount);

    const gap = () => { for (let i = 0; i < gapPerSection; i++) sp(); };

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

    line();
    gap();
    c.addChild(new Text(section(`  Files ${muted(`(${sessionFiles.size})`)}`), 0, 0));
    sp();

    if (sessionFiles.size > 0) {
      // Deleted files first, then by most recent
      const sorted = [...sessionFiles].sort((a, b) => {
        if (a[1].deleted !== b[1].deleted) return a[1].deleted ? -1 : 1;
        return 0;
      });
      const MAX_FILES = 8;
      for (const [name, info] of sorted.slice(0, MAX_FILES)) {
        if (info.deleted) {
          c.addChild(new Text(`  ${theme.fg("error", strikethrough(trunc(name, W - 5)))}`, 0, 0));
        } else {
          const diff = computeDiff(info.firstContent, info.latestContent);
          const add = diff.additions > 0 ? dim(` +${diff.additions}`) : "";
          const del = diff.deletions > 0 ? dim(` -${diff.deletions}`) : "";
          c.addChild(new Text(`  ${text(trunc(name, W - 10))}${add}${del}`, 0, 0));
        }
      }
      if (sorted.length > MAX_FILES) {
        c.addChild(new Text(`  ${dim(`+${sorted.length - MAX_FILES} more`)}`, 0, 0));
      }
    } else {
      c.addChild(new Text(`  ${dim("no changes")}`, 0, 0));
    }

    line();
    gap();

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
      const pct = Math.round(usage.percent ?? ((usage.tokens || 0) / usage.contextWindow) * 100);
      c.addChild(new Text(`  ${muted("ctx")}   ${miniBar(pct, 6)} ${text(`${pct}%`)}`, 0, 0));
    }

    const cost = ctxRef ? computeSessionCost(ctxRef) : 0;
    if (cost > 0) c.addChild(new Text(`  ${muted("cost")}  ${text(`$${cost.toFixed(3)}`)}`, 0, 0));

    line();
    gap();

    // ── Tasks ──
    c.addChild(new Text(section("  Tasks"), 0, 0));
    sp();

    if (todos.length > 0) {
      const done = todos.filter((t) => t.done).length;
      const total = todos.length;
      const pct = Math.round((done / total) * 100);

      c.addChild(new Text(`  ${muted(`${done}/${total}`)} ${miniBar(pct, 6)} ${text(`${pct}%`)}`, 0, 0));
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
    gap();

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
    if (event.toolName === "todo") {
      const details = event.result?.details as TodoDetails | undefined;
      if (details?.todos) todos = details.todos;
    }

    // Track modified files from edit/write results
    if (event.toolName === "edit" || event.toolName === "write") {
      const text = event.result?.content?.map(c => (c as any).text || "").join("") || "";
      // "Successfully replaced N block(s) in path/to/file"
      const match = text.match(/in\s+(\S+)/);
      if (match) {
        const filePath = match[1];
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
