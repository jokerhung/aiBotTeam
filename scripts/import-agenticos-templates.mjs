// Apache-2.0 agenticos templates, pinned for reproducible one-time imports.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
const revision = "a8c16d6b30571c636462e99a7221cf3724861057";
const prefix = "backend/app/core/catalog/agent_templates/";
const local = process.argv.includes("--source-dir") ? resolve(process.argv[process.argv.indexOf("--source-dir") + 1]) : null;
const tree = local ? execFileSync("git", ["ls-tree", "-r", "--name-only", revision], { cwd: local, encoding: "utf8" }).split("\n")
  : (await (await fetch(`https://api.github.com/repos/vstorm-co/agenticos/git/trees/${revision}?recursive=1`)).json()).tree.map((x) => x.path);
const paths = tree.filter((p) => p.startsWith(prefix) && p.endsWith("/AGENT.md") && !p.includes("/general/"));
if (paths.length !== 28) throw Error(`Expected 28 templates, found ${paths.length}`);
const records = await Promise.all(paths.map(async (path) => ({ path, text: local ? readFileSync(resolve(local, path), "utf8") : await (await fetch(`https://raw.githubusercontent.com/vstorm-co/agenticos/${revision}/${path}`)).text() })));
const parser = `import json,sys,yaml\nout=[]\nfor r in json.load(sys.stdin):\n _,head,body=r['text'].split('---',2)\n meta=yaml.safe_load(head)\n industry,tid=r['path'].split('/')[-3:-1]\n desc=meta['description']\n hints=[k+': '+', '.join(str(x) for x in meta.get(k,[])) for k in ['skills','mcp'] if meta.get(k)]\n if hints: desc+=' Suggested integrations (not installed): '+'; '.join(hints)+'.'\n out.append({'industry':industry,'id':tid,'text':'---\\n'+yaml.safe_dump({'name':meta['name'],'description':desc,'industry':industry},allow_unicode=True,sort_keys=False)+'---\\n\\n'+body.strip()+'\\n'})\nprint(json.dumps(out,ensure_ascii=False))`;
const parsed = JSON.parse(execFileSync("uv", ["run", "--project", "server", "python", "-c", parser], { input: JSON.stringify(records), encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } }));
for (const r of parsed) {
  const dir = `server/botteam/templates/${r.industry}`; mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${r.id}.md`, r.text + `\n<!-- Source: https://github.com/vstorm-co/agenticos/blob/${revision}/${prefix}${r.industry}/${r.id}/AGENT.md | Apache-2.0. Modified: configuration fields removed; suggested skills/MCP retained in description. -->\n`);
}
console.log(`Imported ${parsed.length} agent templates from agenticos ${revision}.`);
