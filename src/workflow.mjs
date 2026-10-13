// Scripted sales agent: the same loop an AI agent runs, written as plain code so every step is visible.
//   1. create leads   2. verify e-mail   3. prepare drafts   4. wait for human approval
//   5. work replies   6. schedule follow-ups
// Runs against the no-key demo by default; set COLDLEADS_API_KEY to use your own workspace.
//   node src/workflow.mjs [--leads leads.json] [--approve=never|always] [--transcript run.json]
import { readFile, writeFile } from "node:fs/promises";
import { connect } from "./coldleads.mjs";
import { askApproval } from "./approval.mjs";

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const leadsFile = arg("--leads") ?? new URL("../leads.example.json", import.meta.url);
const transcriptFile = arg("--transcript");
const TAG = "q4-prospects";

const transcript = { started_at: new Date().toISOString(), endpoint: "", steps: [] };
let step = null;
const begin = (title) => { step = { title, calls: [], notes: [] }; transcript.steps.push(step); console.log(`\n■ ${title}`); };
const note = (line) => { step.notes.push(line); console.log(`  ${line}`); };

// Same rule as Cold Leads templates: {name} / {company}; an empty value also drops the comma before it.
const fill = (text, c) => text.replace(/(,\s*)?\{(name|company)\}/g, (_w, sep, key) => (c[key] ? (sep ?? "") + c[key] : ""));
const firstName = (name) => (name || "").split(/\s+/)[0];

const cl = await connect({ onCall: (c) => step?.calls.push(c) });
const { crm } = cl.client;
const t = cl.track;
transcript.endpoint = cl.endpoint;
console.log(`Cold Leads ${cl.live ? "live workspace" : "demo (sample data, never sends)"}: ${cl.endpoint}`);
console.log(`Tools that need human approval: ${[...cl.needsApproval].join(", ")}`);

try {
  begin("Workspace");
  const info = await t("get_workspace_info", {}, () => crm.workspace());
  note(`${info.workspace?.name ?? "workspace"}; mailbox ${info.workspace?.mailbox_configured ? "connected" : "not connected"}; ${info.counts?.contacts ?? 0} contacts`);

  // 1. Create leads. Importing never sends e-mail. consent "b2b_outreach" only if you have a lawful basis for cold outreach.
  begin("1. Create leads");
  const leads = JSON.parse(await readFile(leadsFile, "utf8"));
  const rows = leads.map((l) => ({ ...l, tags: TAG }));
  const imported = await t("import_contacts", { contacts: rows }, () => crm.importContacts({ contacts: rows }));
  note(`added ${imported.added}, skipped ${imported.skipped} (already in the CRM or do-not-contact), errors ${imported.errors?.length ?? 0}`);
  const { contacts } = await t("list_contacts", { tag: TAG, limit: 100 }, () => crm.contacts({ tag: TAG, limit: 100 }));

  // 2. Verify every address (1 credit each with a live key).
  begin("2. Verify e-mail addresses");
  const sendable = [];
  for (const c of contacts) {
    const v = await t("verify_email", { email: c.email }, () => crm.verifyEmail(c.email));
    note(`${c.email}: ${v.validity ?? "not checked"} (score ${v.score ?? "-"}, ${v.reasons?.join(", ") || "no flags"})`);
    if (v.validity === "invalid") {
      // keep it out of the campaign: the audience is selected by tag
      const notes = `verify_email: ${v.reasons?.join(", ")}`;
      await t("update_contact", { contact_id: c.id, tags: "bad-address", notes }, () => crm.updateContact({ contactId: c.id, tags: "bad-address", notes }));
      note(`  → retagged bad-address, excluded from outreach`);
    } else sendable.push(c);
  }

  // 3. Prepare drafts: one template with {name}/{company}, a preview per recipient, and a campaign draft.
  begin("3. Prepare outreach drafts");
  const subject = "Reporting for {company}";
  const body = "Hi, {name},\n\nI noticed {company} is growing its operations team. We build reporting dashboards that replace weekly spreadsheet exports.\n\nWould a 15-minute call next week be useful?\n\nAlex";
  for (const c of sendable) note(`Draft to ${c.email}\n    Subject: ${fill(subject, c)}\n    ${fill(body, { ...c, name: firstName(c.name) }).replace(/\n/g, "\n    ")}`);
  const { template } = await t("save_template", { name: "Q4 intro", subject, body }, () => crm.saveTemplate({ name: "Q4 intro", subject, body }));
  const draft = await t("create_campaign_draft", { name: "Q4 prospects", template_id: template.id, tag: TAG }, () => crm.createCampaignDraft({ name: "Q4 prospects", templateId: template.id, tag: TAG }));
  note(`campaign draft ${draft.campaign.id}: ${draft.recipient_estimate} recipient(s), status ${draft.campaign.status}. ${draft.note}`);

  // 4. Human approval before anything is sent.
  begin("4. Approval");
  const approved = await askApproval(`Launch campaign "${draft.campaign.name}" to ${draft.recipient_estimate} recipient(s)?\nTemplate: ${subject}`, cl);
  if (approved) {
    const r = await t("launch_campaign", { campaign_id: draft.campaign.id, confirm_launch: true }, () => crm.launchCampaign(draft.campaign.id, { confirmLaunch: true }));
    note(`launch_campaign → ${r.status}${r.note ? `: ${r.note}` : ""}`);
  } else note("not launched; the draft stays in Cold Leads for review");

  // 5. Work replies and due follow-ups (the same queue as Inbox → Today in the app).
  begin("5. Process replies");
  const queue = await t("get_sales_next_actions", {}, () => crm.nextActions());
  note(`${queue.count} item(s) need attention`);
  for (const a of queue.actions) {
    const ctx = await t("get_lead_context", { contact_id: a.contact_id }, () => crm.leadContext({ contactId: a.contact_id }));
    const last = ctx.recent_messages?.filter((m) => m.direction === "in").at(-1);
    note(`${a.priority.toUpperCase()} ${a.action}: ${a.name || a.email} (${a.company}). ${a.reason}`);
    if (last) note(`  last reply (${last.reply_class}): "${last.text}"`);
    if (!ctx.contactability.safe_to_contact) { note("  → not safe to contact, skipped"); continue; }
    const message = a.action === "reply"
      ? `Hi ${firstName(a.name)},\n\nThanks for getting back to me. I'll send the details you asked for today. Would Tuesday or Wednesday work for a short call?\n\nAlex`
      : `Hi ${firstName(a.name)},\n\nChecking in as promised: how did the pilot go, and is there anything you need from us?\n\nAlex`;
    if (await askApproval(`Send to ${a.email}:\n${message}`, cl)) {
      const sent = await t("send_contact_message", { contact_id: a.contact_id, message, confirm_send: true }, () => crm.sendMessage({ contactId: a.contact_id, message, confirmSend: true }));
      note(`  send_contact_message → ${sent.status}${sent.subject ? ` ("${sent.subject}")` : ""}`);
      // 6. Record the next step so the next session (human or agent) knows what to do.
      const f = await t("schedule_follow_up", { contact_id: a.contact_id, in_days: 3, note: "Follow up if no answer" }, () => crm.scheduleFollowUp({ contactId: a.contact_id, inDays: 3, note: "Follow up if no answer" }));
      note(`  follow-up scheduled for ${f.next_action_due}`);
    } else {
      const pending = "Reply drafted by the agent, waiting for approval";
      await t("schedule_follow_up", { contact_id: a.contact_id, in_days: 0, note: pending }, () => crm.scheduleFollowUp({ contactId: a.contact_id, inDays: 0, note: pending }));
      note("  not sent; follow-up kept for today");
    }
  }

  begin("6. Audit log");
  const log = await t("get_agent_activity", { limit: 200 }, () => crm.activity(200));
  note(`${log.count} tool call(s) recorded for this workspace`);
} finally {
  if (transcriptFile) {
    await writeFile(transcriptFile, JSON.stringify(transcript, null, 2));
    console.log(`\nTranscript written to ${transcriptFile}`);
  }
}
