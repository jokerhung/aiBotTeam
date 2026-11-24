# Skills UI and gallery migration — 2026-11-23

Reviewed the authenticated agenticos 1.90.1 Skills page at `http://100.111.238.91:3000/skills`, its Skill gallery, industry shelves, previews and New skill editor. BotTeam now follows its preview-card layout, stacked document preview, category/usage filters, used-by labels, Add to an agent flow and file/instruction editor. BotTeam keeps its workspace frame and existing global enabled/disabled behavior. Visibility is Everyone because the local app has no organization/user sharing model; unsupported sharing controls are not shown.

## Migrated data

- Source: agenticos revision `a8c16d6b30571c636462e99a7221cf3724861057`, Apache-2.0. License and source attribution accompany the bundle.
- All **80 gallery skills across seven industries**, plus **17 supporting Markdown files**, are bundled under `server/botteam/skill_gallery/`.
- Compared every key, instruction body and supporting-file list against the authenticated running reference's gallery API: all matched. The importer copies the pinned source files without changing their instructions.
- Installed all 80 through the new BotTeam gallery UI on this machine. Existing `social-media-writing` was preserved with its content, enabled state and assignment. The final library contains **81 skills**.
- Repeated installation skips existing skills without replacing user edits, changing enabled state or creating duplicates. Installation does not assign new skills to agents.
- Installed files remain under the configured data directory's `skills/<id>/`. Claude's turn directory includes relative reference files. Other engines receive files under their workspace `.botteam/skills/<id>/`, with the directory named in the skill instructions.

## Verification

- Server: **25 tests passed** across skill gallery, memory/skills, bot export/import and team export/import. These cover the full offline catalog, idempotent installation, preserving custom skills and edits, supporting-file access for Claude and other engines, file traversal rejection, gallery APIs, categories and agent assignments.
- Web: **69 tests passed**, including filtering/sorting without mutating input and Vietnamese category/industry labels. TypeScript and targeted ESLint passed.
- `pnpm test:skills` passed: installs the whole gallery; checks all seven shelves and all 20 software skills; previews instructions; opens `docs/api.md`; creates, previews and edits a test skill; assigns it while preserving an existing agent skill; tests search/category filters and a 390px viewport. Temporary test skill and Echo agent are removed in `finally`; the requested gallery migration is retained.
- `pnpm build:static` passed. Existing CSS `::highlight` optimization warnings and the normal static-export/proxy warning remain.
- Built the Python wheel and checked its contents: 80 `SKILL.md` files, 17 supporting files, catalog metadata and Apache license are included (99 gallery files total).
- Local library/gallery requests after migration returned in approximately 0.08 seconds each. No runtime request to agenticos is required.

Screenshots are generated under ignored `web/e2e/actual/skills-*.png`. The reproducible importer is `scripts/import-agenticos-skills.py --source-dir <agenticos-checkout>` and requires the existing server Python environment. README and both installation scripts document that the gallery ships with the package and requires no new service, port or prerequisite.
