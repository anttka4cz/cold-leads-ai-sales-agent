// Cold Leads client for the agent, built on the official SDK (npm: @coldleads/sdk).
// No COLDLEADS_API_KEY: demo mode against https://coldleads.app/api/mcp/demo (sample data, never sends e-mail).
// With COLDLEADS_API_KEY (secret key sk_..., Business plan): your real workspace.
import ColdLeads, { isColdLeadsError } from "@coldleads/sdk";

const BASE = (process.env.COLDLEADS_BASE_URL || "https://coldleads.app").replace(/\/$/, "");

export async function connect({ onCall } = {}) {
  const key = process.env.COLDLEADS_API_KEY || "";
  const live = key.startsWith("sk_");
  const client = new ColdLeads({ apiKey: live ? key : "", baseUrl: BASE, demo: !live });

  // Every Cold Leads tool declares its side effect and whether a human must approve it.
  const tools = await client.crm.tools();
  // The agent also asks before any other action outside the CRM (for example creating a public website-form key).
  const needsApproval = new Set(tools.filter((t) => t.requiresApproval || t.sideEffect === "external_side_effect").map((t) => t.name));

  // Runs one SDK call and records it for the transcript; tool errors come back as data, like MCP results.
  async function track(tool, args, run) {
    let result;
    let isError = false;
    try {
      result = await run();
    } catch (e) {
      if (!isColdLeadsError(e)) throw e;
      result = e.body && typeof e.body === "object" ? e.body : { status: "error", error: e.code, message: e.message };
      isError = true;
    }
    onCall?.({ tool, args, result, isError });
    return result;
  }

  return {
    live,
    endpoint: `${BASE}${live ? "/api/mcp" : "/api/mcp/demo"}`,
    client,
    tools,
    needsApproval,
    track,
    // generic call by MCP tool name (used by the Claude-driven agent)
    call: (name, args = {}) => track(name, args, () => client.crm.callTool(name, args)),
  };
}
