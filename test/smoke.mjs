// Runs the scripted agent end to end against the no-key demo (or COLDLEADS_BASE_URL) with every approval declined,
// and checks that each stage produced the expected result and that nothing was sent.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = join(tmpdir(), `cl-agent-${process.pid}.json`);
const env = { ...process.env, COLDLEADS_API_KEY: "" };
await promisify(execFile)(process.execPath, ["src/workflow.mjs", "--approve=never", "--transcript", out], { env, timeout: 120_000 });
const run = JSON.parse(await readFile(out, "utf8"));
await rm(out, { force: true });

const calls = run.steps.flatMap((s) => s.calls);
const results = (tool) => calls.filter((c) => c.tool === tool).map((c) => c.result);
const check = (ok, message) => { if (!ok) { console.error(`✘ ${message}`); process.exitCode = 1; } else console.log(`✔ ${message}`); };

check(run.endpoint.endsWith("/api/mcp/demo"), "uses the no-key demo endpoint");
check(results("import_contacts")[0]?.added === 3, "creates the three leads");
check(results("verify_email").map((r) => r.validity).sort().join() === "invalid,valid,valid", "verifies all three (one invalid)");
check(results("create_campaign_draft")[0]?.recipient_estimate === 2, "drafts a campaign without the invalid address");
check(!calls.some((c) => c.tool === "launch_campaign" || c.tool === "send_contact_message"), "sends nothing without approval");
check(results("get_sales_next_actions")[0]?.count >= 1, "finds replies and follow-ups to work");
check(results("schedule_follow_up").every((r) => r.status === "success"), "keeps declined replies as follow-ups for today");
