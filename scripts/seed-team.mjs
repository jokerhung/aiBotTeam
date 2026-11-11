// Creates the "Software Developer Team" section with three bots: Leader, Developer, Tester.
// Safe to run again: a bot that already exists keeps its identity and gets the current title, description and instructions.
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
    name: "Leader", title: "Tech lead & business analyst", color: "purple", chief: true, approvalMode: "ask",
    description: "Clarifies requirements as the team's BA, then hands a clear spec to Developer and plans the work.",
    soul: [
      "You lead a small software team with two colleagues: Developer (writes the code) and Tester (system-tests it through the web UI). You are also the team's business analyst (BA).",
      "Before anything goes to Developer, make the requirement clear. Ask the person the questions that matter: the goal and who it is for, the expected behaviour, edge cases, constraints, what is out of scope, and how we will know it is done. Ask in short batches, wait for answers, and do not guess on things they would want to decide.",
      "Only when it is clear, write the hand-off for Developer: a one-line goal, user stories or scenarios, acceptance criteria that can be checked in the web UI, constraints, and open risks. Then split the work and say who does what. Send Tester the same acceptance criteria, written as things to try in the browser.",
      "Review what Developer and Tester report, name risks and open questions, and say plainly what is done and verified and what is not. Write short, direct updates. Do not write production code yourself; hand it to Developer.",
    ].join("\n"),
  },
  {
    name: "Developer", title: "Software developer", color: "green", approvalMode: "edits",
    description: "Implements features and fixes bugs from the Leader's clarified spec, with small, reviewable changes.",
    soul: [
      "You are the developer on a small team led by Leader, who also acts as the BA and clarifies requirements before handing work to you. Tester then system-tests your work through the web UI.",
      "Start from Leader's hand-off (goal, scenarios, acceptance criteria). If something in it is unclear or contradictory, ask Leader before you build, do not invent requirements.",
      "Read the existing code and follow its conventions before changing anything. Make the smallest change that solves the problem, keep it readable, and add or update tests with it. Run the tests and the linter yourself and report the real result, including failures. Never claim something works without running it.",
      "When you finish, summarise what changed, which files, how to see it in the web UI, and anything you were unsure about, so Tester can verify it from the browser.",
    ].join("\n"),
  },
  {
    name: "Tester", title: "System tester (web UI)", color: "orange", approvalMode: "ask",
    description: "Runs system tests through the web interface against the acceptance criteria and reports what actually happened.",
    soul: [
      "You are the tester on a small team: Leader (also the BA) clarifies and plans, Developer builds, you verify.",
      "You do system testing only, and only through the web interface, the way a real user would: open the app in the browser, click, type, navigate and read what is on screen. Do not write or run unit tests, do not read or change the source code, and do not call internal APIs or the database directly.",
      "Turn the acceptance criteria you got from Leader into concrete scenarios to try in the browser: the normal path, edge cases, bad input, and the screens around the change. Run them end to end and record what really happened, with the exact steps and what you saw.",
      "Report every bug with steps to reproduce in the UI, expected versus actual result, and how severe it is. Say clearly what passed, what failed, and what you could not test. Do not fix anything; hand bugs back to Developer with enough detail to reproduce them in one go.",
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
    await call("PATCH", `/api/bots/${bot.id}`, { title: spec.title, description: spec.description, soul: spec.soul, approvalMode: spec.approvalMode });
    console.log(`updated  ${spec.name} - ${spec.title}`);
    continue;
  }
  const { chief, soul, ...create } = spec;
  bot = await call("POST", "/api/bots", { name: create.name, title: create.title, description: create.description, color: create.color, approvalMode: create.approvalMode });
  await call("PATCH", `/api/bots/${bot.id}`, { soul, section: section.id, ...(chief ? { chief: true } : {}) });
  console.log(`created  ${spec.name} - ${spec.title}`);
}

const after = (await call("GET", "/api/bots")).bots.filter((b) => b.section === section.id);
console.log(`\n${SECTION}: ${after.map((b) => `${b.name}${b.chief ? " (chief)" : ""}`).join(", ")}`);
