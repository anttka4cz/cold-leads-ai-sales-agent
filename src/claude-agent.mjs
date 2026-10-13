// Claude drives the Cold Leads tools itself. The same human-approval gate applies: any tool the server marks
// coldleads/requires_approval (send_contact_message, launch_campaign) runs only after a person types "yes".
//   ANTHROPIC_API_KEY=... node src/claude-agent.mjs "Verify these three contacts and prepare outreach drafts: ..."
import Anthropic from "@anthropic-ai/sdk";
import { connect } from "./coldleads.mjs";
import { askApproval } from "./approval.mjs";

const DEFAULT_PROMPT =
  "Verify these three contacts and prepare outreach drafts. Don't send anything until I approve. " +
  "Jana Dvořák <jana.dvorak@ridgeline.example> (Ridgeline Logistics), info@harborlane.example (Harbor Lane Coffee), " +
  "Piotr Kowalski <piotr@quillmetrics.example> (Quill Metrics). Then check whether any replies or follow-ups need me today.";
const prompt = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ") || DEFAULT_PROMPT;
const MAX_TURNS = 30;

const cl = await connect();
const anthropic = new Anthropic();
const tools = cl.tools.map((t) => ({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema }));
const system = [
  "You are a sales assistant working in the user's Cold Leads CRM through its tools.",
  cl.instructions,
  "Before any tool that sends e-mail, show the exact recipients and text in your reply; the user is asked to approve each send separately.",
  "Finish with a short summary: what you created, what you verified, which drafts wait for approval, and what is due next.",
].join("\n\n");

console.log(`Cold Leads ${cl.live ? "live workspace" : "demo (sample data, never sends)"}: ${cl.endpoint}\n\n> ${prompt}\n`);
const messages = [{ role: "user", content: prompt }];

try {
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await anthropic.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      // If a safety classifier declines, the API retries on Anthropic's recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      tools,
      messages,
    });
    if (response.stop_reason === "refusal") { console.log("\nClaude declined this request."); break; }
    for (const block of response.content) if (block.type === "text" && block.text.trim()) console.log(block.text.trim());
    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "pause_turn") continue;
    const calls = response.content.filter((b) => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || calls.length === 0) break;

    const results = [];
    for (const call of calls) {
      console.log(`  → ${call.name}(${JSON.stringify(call.input).slice(0, 160)})`);
      if (cl.needsApproval.has(call.name)) {
        const ok = await askApproval(`${call.name}\n${JSON.stringify(call.input, null, 2)}`, cl);
        if (!ok) {
          results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: "The user did not approve this action. Do not retry it; leave it as a draft." });
          continue;
        }
      }
      try {
        const data = await cl.call(call.name, call.input);
        results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(data), ...(data.status === "error" ? { is_error: true } : {}) });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: String(e?.message ?? e) });
      }
    }
    messages.push({ role: "user", content: results });
  }
} catch (e) {
  if (e instanceof Anthropic.AuthenticationError) console.error("Set ANTHROPIC_API_KEY (or run `ant auth login`) to use the Claude-driven agent. `npm start` runs the scripted agent without it.");
  else throw e;
} finally {
  await cl.close();
}
