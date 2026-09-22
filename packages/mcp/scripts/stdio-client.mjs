import { spawn } from "node:child_process";

/**
 * A minimal newline-delimited JSON-RPC client for an MCP stdio server.
 *
 * Deliberately independent of the SDK's client: it speaks the wire protocol
 * directly, records every stdout line, and fails on any stdout line that is not
 * a JSON-RPC message, so protocol output and diagnostics cannot be mixed.
 */
export function startStdioServer(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let stderr = "";
  const pending = new Map();
  const nonProtocol = [];
  const messages = [];
  let nextId = 1;

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() === "") continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        nonProtocol.push(line);
        continue;
      }
      if (message?.jsonrpc !== "2.0") {
        nonProtocol.push(line);
        continue;
      }
      messages.push(message);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  const exited = new Promise((resolve) => child.on("exit", resolve));

  function request(method, params, timeoutMs = 15_000) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timed out waiting for ${method}; stderr: ${stderr}`));
      }, timeoutMs);
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  }

  function notify(method, params) {
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) })}\n`,
    );
  }

  async function initialize(clientInfo, protocolVersion = "2025-11-25") {
    const response = await request("initialize", {
      protocolVersion,
      capabilities: {},
      clientInfo,
    });
    notify("notifications/initialized");
    return response;
  }

  async function close() {
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 5_000);
    const code = await exited;
    clearTimeout(timer);
    return code;
  }

  return {
    child,
    request,
    notify,
    initialize,
    close,
    stderr: () => stderr,
    nonProtocol: () => nonProtocol,
    messages: () => messages,
  };
}
