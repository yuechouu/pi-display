/**
 * Crush-style thinking animation — random hex characters
 *
 * Shows rapidly changing random strings while the model is thinking.
 * Like a decryption/decoding effect.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const CHARS = "0123456789abcdef";
const NUM_FRAMES = 200;
const INTERVAL_MS = 60;

function randomHex(len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    s += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return s;
}

function generateFrames(): string[] {
  const frames: string[] = [];
  for (let i = 0; i < NUM_FRAMES; i++) {
    const hex = randomHex(12);
    // Vary the format for visual interest
    if (i % 5 === 0) {
      frames.push(`thinking ${hex.slice(0, 4)}…${hex.slice(-4)}`);
    } else if (i % 7 === 0) {
      frames.push(`thinking ${hex.slice(0, 6)}`);
    } else {
      frames.push(`thinking ${hex}`);
    }
  }
  return frames;
}

export default function (pi: ExtensionAPI) {
  let enabled = true;

  // Set the custom indicator on session start
  pi.on("session_start", (_event, ctx) => {
    if (enabled) {
      setThinkingIndicator(ctx);
    }
  });

  function setThinkingIndicator(ctx: ExtensionContext) {
    ctx.ui.setWorkingIndicator({
      frames: generateFrames(),
      intervalMs: INTERVAL_MS,
    });
  }

  // Command to toggle
  pi.registerCommand("thinking-anim", {
    description: "Toggle Crush-style thinking animation",
    handler: async (_args, ctx) => {
      enabled = !enabled;
      if (enabled) {
        setThinkingIndicator(ctx);
        ctx.ui.notify("Thinking animation: random hex", "info");
      } else {
        ctx.ui.setWorkingIndicator(); // Reset to default
        ctx.ui.notify("Thinking animation: default spinner", "info");
      }
    },
  });
}
