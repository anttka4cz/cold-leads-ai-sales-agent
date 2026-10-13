// Human approval for anything that sends e-mail. Nothing is sent unless a person types "yes".
// --approve=never answers "no" to every request (useful for dry runs and CI);
// --approve=always answers "yes" and is accepted only against the demo server, which never sends.
import readline from "node:readline/promises";

const flag = process.argv.find((a) => a.startsWith("--approve="))?.split("=")[1];

// Text in the summary can come from the model or from e-mail replies: strip terminal control sequences so it cannot
// redraw the prompt or fake an answer.
const clean = (text) => String(text).replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]|\u001b\][^\u0007]*(\u0007|\u001b\\)|[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");

export async function askApproval(summary, { live }) {
  summary = clean(summary);
  console.log(`\n  ⏸  Approval needed\n${summary.split("\n").map((l) => `     ${l}`).join("\n")}`);
  if (flag === "never") { console.log("     → not approved (--approve=never)"); return false; }
  if (flag === "always") {
    if (live) throw new Error("--approve=always is refused with a live API key; approve each send yourself.");
    console.log("     → approved (--approve=always, demo server never sends)");
    return true;
  }
  if (!process.stdin.isTTY) { console.log("     → not approved (no terminal to ask)"); return false; }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("     Type yes to approve: ")).trim().toLowerCase();
  rl.close();
  return answer === "yes";
}
