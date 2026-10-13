// Connects to the Cold Leads MCP server.
// No COLDLEADS_API_KEY: the no-key demo at https://coldleads.app/api/mcp/demo (sample data, never sends e-mail).
// With COLDLEADS_API_KEY (secret key sk_..., Business plan): your real workspace at https://coldleads.app/api/mcp.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = (process.env.COLDLEADS_BASE_URL || "https://coldleads.app").replace(/\/$/, "");

export async function connect({ onCall } = {}) {
  const key = process.env.COLDLEADS_API_KEY || "";
  const live = key.startsWith("sk_");
  const url = new URL(live ? `${BASE}/api/mcp` : `${BASE}/api/mcp/demo`);
  const transport = new StreamableHTTPClientTransport(url, live ? { requestInit: { headers: { Authorization: `Bearer ${key}` } } } : {});
  const client = new Client({ name: "cold-leads-ai-sales-agent", version: "1.0.0" });
  await client.connect(transport);
  const { tools } = await client.listTools();

  // Every Cold Leads tool declares its side effect and whether a human must approve it (_meta).
  const needsApproval = new Set(tools.filter((t) => t._meta?.["coldleads/requires_approval"]).map((t) => t.name));

  async function call(name, args = {}) {
    const res = await client.callTool({ name, arguments: args });
    const text = res.content?.find((c) => c.type === "text")?.text ?? "{}";
    let data;
    try { data = JSON.parse(text); } catch { data = { status: "error", message: text }; }
    onCall?.({ tool: name, args, result: data, isError: !!res.isError });
    return data;
  }

  return {
    live,
    endpoint: url.toString(),
    tools,
    instructions: client.getInstructions() ?? "",
    needsApproval,
    call,
    close: async () => { await transport.terminateSession().catch(() => {}); await client.close(); },
  };
}
