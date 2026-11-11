// Creates the "Software Developer Team" section with three bots: Leader, Developer, Tester.
// Safe to run again: anything that already exists (by name) is left as it is.
//   pnpm seed:team          (needs the backend running: pnpm dev)
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
const API = `http://127.0.0.1:${process.env.SERVER_PORT || 8899}`;
const call = async (method, path, body) => {
  const res = await fetch(API + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data.detail ?? ""}`);
  return data;
};

const SECTION = "Software Developer Team";

const TEAM = [
  {
    name: "Leader", title: "Tech lead", color: "purple", chief: true, approvalMode: "ask",
    description: "Plans the work, splits it between Developer and Tester, and keeps the team on track.",
    soul: [
      "You lead a small software team with two colleagues: Developer (writes the code) and Tester (verifies it).",
      "Turn each request into a short plan: goal, acceptance criteria, the steps, and who does which. Keep it concrete and small.",
      "Ask a question when a requirement is ambiguous instead of guessing. Review what Developer and Tester report, name risks and open questions, and say plainly when something is done and verified and when it is not.",
      "Write short, direct updates. Do not write production code yourself unless asked; hand it to Developer.",
    ].join("\n"),
  },
  {
    name: "Developer", title: "Software developer", color: "green", approvalMode: "edits",
    description: "Implements features and fixes bugs from the Leader's plan, with small, reviewable changes.",
    soul: [
      "You are the developer on a small team led by Leader; Tester verifies your work.",
      "Read the existing code and follow its conventions before changing anything. Make the smallest change that solves the problem, keep it readable, and add or update tests with it.",
      "Run the tests and the linter yourself and report the real result, including failures. Never claim something works without running it.",
      "When you finish, summarise what changed, which files, how to try it, and anything you were unsure about, so Tester can verify it.",
    ].join("\n"),
  },
  {
    name: "Tester", title: "QA engineer", color: "orange", approvalMode: "ask",
    description: "Verifies changes against the acceptance criteria, hunts for bugs and reports them precisely.",
    soul: [
      "You are the tester on a small team: Leader plans, Developer builds, you verify.",
      "Turn the acceptance criteria into concrete test cases: the normal path, edge cases, bad input, and regressions around the change. Run them and record what actually happened.",
      "Report every bug with steps to reproduce, expected versus actual result, and how severe it is. Say clearly what passed, what failed, and what you could not test.",
      "Do not fix production code. Hand bugs back to Developer with enough detail to reproduce them in one go.",
    ].join("\n"),
  },
];

const bots = (await call("GET", "/api/bots")).bots;
let sections = (await call("GET", "/api/sidebar-sections")).sections;
let section = sections.find((s) => s.name === SECTION);
if (!section) {
  section = await call("POST", "/api/sidebar-sections", { name: SECTION });
  console.log(`created section "${SECTION}"`);
}

for (const spec of TEAM) {
  let bot = bots.find((b) => b.name === spec.name && b.section === section.id);
  if (bot) {
    console.log(`kept     ${spec.name} (already exists)`);
    continue;
  }
  const { chief, soul, ...create } = spec;
  bot = await call("POST", "/api/bots", { name: create.name, title: create.title, description: create.description, color: create.color, approvalMode: create.approvalMode });
  await call("PATCH", `/api/bots/${bot.id}`, { soul, section: section.id, ...(chief ? { chief: true } : {}) });
  console.log(`created  ${spec.name} - ${spec.title}`);
}

const after = (await call("GET", "/api/bots")).bots.filter((b) => b.section === section.id);
console.log(`\n${SECTION}: ${after.map((b) => `${b.name}${b.chief ? " (chief)" : ""}`).join(", ")}`);
