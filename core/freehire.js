// Minimal MCP client for freehire's remote server (stateless streamable HTTP).
const URL_ = "https://freehire.me/api/v1/mcp";
let seq = 0;

async function rpc(method, params) {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, params }),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`freehire ${res.status}: ${text.slice(0, 200)}`);
  const line = text.split("\n").filter((l) => l.startsWith("data:")).pop();
  const msg = JSON.parse(line ? line.slice(5) : text);
  if (msg.error) throw new Error("freehire: " + msg.error.message);
  return msg.result;
}

export async function call(name, args) {
  const r = await rpc("tools/call", { name, arguments: args });
  if (r.isError) throw new Error(`freehire ${name}: ${(r.content || []).map((c) => c.text).join(" ").slice(0, 300)}`);
  if (r.structuredContent) return r.structuredContent;
  return JSON.parse((r.content || []).find((c) => c.type === "text").text);
}
