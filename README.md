# Cold Leads AI sales agent

A complete, runnable reference agent for [Cold Leads](https://coldleads.app/developers?utm_source=github&utm_medium=readme&utm_campaign=sales-agent), the B2B outreach CRM. It runs the whole loop over the Cold Leads MCP server:

1. **Create leads**: import prospects (deduplicated, do-not-contact addresses skipped, never sends e-mail)
2. **Verify** every address and keep invalid ones out of outreach
3. **Prepare drafts**: a personalised template, a preview per recipient and a campaign draft with a recipient estimate
4. **Wait for human approval**: nothing is sent until a person types `yes`
5. **Process replies**: the queue of replies waiting for an answer, with each lead's history and reply class
6. **Follow up**: record the next step on each contact so the next session (human or agent) picks it up

It runs in about a minute **without an API key**, against the hosted demo server `https://coldleads.app/api/mcp/demo`. The demo has the same tools as the live server over a sample workspace (fictional contacts on `.example` domains); it never sends e-mail and uses no credits.

## Run it (no key)

```bash
git clone https://github.com/anttka4cz/cold-leads-ai-sales-agent
cd cold-leads-ai-sales-agent
npm install
npm start
```

Node.js 20 or newer. You are asked to approve the campaign launch and each reply; answer `yes` or anything else. `npm start -- --approve=never` declines everything, and `npm test` runs the same flow and checks every stage.

### Let Claude drive it

`src/claude-agent.mjs` gives Claude (`claude-opus-5-5`) the Cold Leads tools and your request. The approval gate is the same: tools the server marks `coldleads/requires_approval` (`send_contact_message`, `launch_campaign`) run only after you type `yes`.

```bash
export ANTHROPIC_API_KEY=...
npm run claude
npm run claude -- "Which replies need me today? Draft answers but don't send them."
```

## Use your own workspace

```bash
export COLDLEADS_API_KEY=sk_...   # Cold Leads → Settings → API keys (Business plan)
npm start -- --leads my-leads.json
```

With a key the agent connects to `https://coldleads.app/api/mcp` and works in your real CRM:

- Each `verify_email` costs 1 credit.
- An approved launch or reply **really sends** from your connected mailbox, with Cold Leads' opt-out, bounce, do-not-contact and content rules applied.
- `--approve=always` is refused with a live key.
- Edit `leads.example.json` or pass your own file. Set `"consent": "b2b_outreach"` only where you have a lawful basis for cold outreach; website sign-ups are `inquiry` leads.

## What the code shows

| File | What it does |
| --- | --- |
| `src/coldleads.mjs` | Connects with the official MCP client over Streamable HTTP. It reads `coldleads/requires_approval` from each tool's `_meta`, so the approval list comes from the server, not from a hard-coded list. |
| `src/workflow.mjs` | The scripted agent: every MCP call of the six steps in order. `--transcript run.json` saves every call and result. |
| `src/claude-agent.mjs` | A Claude tool-use loop over the same tools, with the approval gate on sending tools. |
| `src/approval.mjs` | The human-in-the-loop prompt. |

## Limits worth knowing

- Cold Leads has no third-party lead database and does not enrich contacts. You bring the leads.
- Live verification checks syntax, disposable domains, role addresses and MX records. The mailbox (SMTP) check runs only when Cold Leads can reach the recipient's mail server; otherwise the result says `smtp_unreachable`. The demo's sample results use the same reason codes.
- The demo keeps your changes for one MCP session (24 hours), visible only to that session.

## Links

- [Developer docs](https://coldleads.app/developers?utm_source=github&utm_medium=readme&utm_campaign=sales-agent)
- [MCP server](https://github.com/anttka4cz/mcp-server-coldleads)
- [Node.js SDK](https://github.com/anttka4cz/coldleads-node-sdk)
- [REST API](https://coldleads.app/api/v1) · [OpenAPI](https://coldleads.app/api/v1/openapi.json)

MIT licensed.
