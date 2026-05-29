/**
 * Todo Widget Extension
 *
 * Displays a persistent todo list widget above the editor.
 * Integrates with the existing todo tool from pi's built-in extensions.
 * Shows tasks with ✓ (completed) and • (pending) markers.
 *
 * The widget updates automatically when todos change.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

interface Todo {
  id: number;
  text: string;
  done: boolean;
}

interface TodoDetails {
  action: string;
  todos: Todo[];
  nextId: number;
}

const WIDGET_KEY = "todo-widget";

export default function (pi: ExtensionAPI) {
  let todos: Todo[] = [];
  let expanded = false;

  // Reconstruct todo state from session entries
  function reconstructState(ctx: ExtensionContext) {
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

  // Build the widget content
  function buildWidget(theme: any): string[] {
    if (todos.length === 0) return [];

    const done = todos.filter((t) => t.done).length;
    const total = todos.length;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;

    const lines: string[] = [];

    // Header
    const progressBar = buildProgressBar(progress, 20);
    const headerText = theme.fg("accent", " Tasks ") +
      theme.fg("muted", `${done}/${total}`) +
      " " + progressBar;
    lines.push(headerText);

    // Todo items
    const display = expanded ? todos : todos.filter((t) => !t.done).slice(0, 5);
    for (const todo of display) {
      const icon = todo.done
        ? theme.fg("success", "✓")
        : theme.fg("dim", "•");
      const text = todo.done
        ? theme.fg("dim", todo.text)
        : theme.fg("text", todo.text);
      const id = theme.fg("muted", `#${todo.id}`);
      lines.push(`  ${icon} ${id} ${text}`);
    }

    // Show remaining count if collapsed
    const pending = todos.filter((t) => !t.done);
    if (!expanded && pending.length > 5) {
      lines.push(theme.fg("dim", `  ... ${pending.length - 5} more pending`));
    }
    if (!expanded && done > 0) {
      lines.push(theme.fg("dim", `  ${done} completed (hidden)`));
    }

    // Expand hint
    lines.push(theme.fg("dim", expanded ? "  [−] collapse" : "  [+] expand"));

    return lines;
  }

  function buildProgressBar(percent: number, width: number): string {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);
    return `[${bar}] ${percent}%`;
  }

  // Update widget display
  function updateWidget(ctx: ExtensionContext) {
    const content = buildWidget(ctx.ui.theme);
    if (content.length > 0) {
      ctx.ui.setWidget(WIDGET_KEY, content, { placement: "aboveEditor" });
    } else {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
    }
  }

  // Listen for todo changes
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName === "todo") {
      const details = event.result?.details as TodoDetails | undefined;
      if (details?.todos) {
        todos = details.todos;
        updateWidget(ctx);
      }
    }
  });

  // Reconstruct on session events
  pi.on("session_start", async (_event, ctx) => {
    reconstructState(ctx);
    updateWidget(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    reconstructState(ctx);
    updateWidget(ctx);
  });

  // Toggle expand/collapse on turn_end (widget click isn't supported,
  // so we toggle via a /todo-expand command)
  pi.registerCommand("todo-expand", {
    description: "Toggle todo widget expanded/collapsed",
    handler: async (_args, ctx) => {
      expanded = !expanded;
      updateWidget(ctx);
    },
  });
}
