import type { AgentTool } from "./agent.ts";

const maximumSeconds = 120;

function requestedSeconds(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("wait requires an object with time in seconds.");
  const args = value as Record<string, unknown>;
  if (Object.keys(args).length !== 1 || typeof args.time !== "number" || !Number.isFinite(args.time) || args.time <= 0 || args.time > maximumSeconds) {
    throw new Error(`wait time must be greater than 0 and at most ${maximumSeconds} seconds.`);
  }
  return args.time;
}

export const waitTool: AgentTool = {
  definition: { type: "function", function: {
    name: "wait",
    description: "Wait for a specified time before continuing. Use when a page or background action needs time to update, then inspect the result. Time is in seconds, up to 120.",
    parameters: { type: "object", properties: {
      time: { type: "number", exclusiveMinimum: 0, maximum: maximumSeconds, description: "Time to wait in seconds." },
    }, required: ["time"], additionalProperties: false },
  } },
  execute: async (value, signal) => {
    const time = requestedSeconds(value);
    if (signal.aborted) throw signal.reason;
    const started = performance.now();
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, Math.ceil(time * 1_000));
      signal.addEventListener("abort", onAbort, { once: true });
    });
    return JSON.stringify({ elapsedSeconds: Math.round((performance.now() - started) / 10) / 100 });
  },
};
