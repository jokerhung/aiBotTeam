# Phase 11 verification — 2026-11-23

Grouping correction (2026-11-24): the apparent duplicate v1/v2 cards in the user's data were separate image/post IDs. All now groups referenced images under their parent post/page; standalone images remain visible and the Images tab includes every image. Verified the actual library displays four cards (three posts plus the research report) rather than seven. The browser regression covers this grouping and explicit Images access; 70 web tests and TypeScript passed.

Update 2026-11-24: the requested browsing flow replaces unversioned-link canonicalization. `#/resources/<id>` now opens a dedicated version-card screen styled after Skills; only selecting a version opens details at `.../v/<n>`. Closing details returns to versions. The browser regression verifies three versions under one library card and this navigation, alongside the existing approval/edit/restore checks. All 69 web tests, TypeScript and the browser regression passed. Installation requirements are unchanged.

Implemented the plan in [phase-11-resources.md](../phase-11-resources.md). The authenticated reference app at `http://100.111.238.91:3000/apps` was reviewed before implementation (agenticos 1.90.1). Its library layout, cards and workspace frame informed the screen; the four resource kinds, explicit version links and human approval rules follow the BotTeam plan.

## Automated checks

- Full server suite: 433 passed, 1 skipped, 1 browser timeout. Re-running `test_mcp_lazy_profile_approval_and_human_control` separately passed (14.41 s). That browser test is unrelated to resource storage.
- Resource tests: 8 passed, covering content stored only in files, relocation, immutable versions, exact edits, stale updates, retention and references, images/HTML isolation, owner/capability controls, actual native tool chat-card creation, publication gates, invalid files/settings, truncated agent reads, missing-file skips, and backup/restore.
- Combined Resources/Routines/API regression tests: 39 passed, including the native card and audit changes.
- Final Resources/Routines regression run after automatic pruning on routine changes and returning resolved versions from `trigger`: 24 passed. Final browser run and production build also passed.
- Web: 67 tests passed, including navigation/version parsing and Vietnamese labels; TypeScript and targeted ESLint passed.
- `pnpm build:static` passed. Existing CSS `::highlight` optimizer warnings and the normal static-export/proxy warning remain.
- `pnpm test:resources` passed against the running app: search/library cards; unversioned URL resolution; Markdown edits, restore and approval isolation; sandboxed HTML unable to read the parent document; post/image preview; routine pinned to approved v1 after creation of v2; version selector warns about an unapproved version.

Browser screenshots are generated under ignored `web/e2e/actual/phase11-*.png`. The browser test creates temporary resources, an Echo agent and a disabled routine, then removes them in `finally`. It needs the app on ports 5299/8899, overridable with `BASE`/`API`.

## Real Creator and Scheduler

Used the existing configured Creator (Codex) and Scheduler (Claude Code) in separate acceptance-test conversations. No model settings, connected apps, custom instructions or existing routines were changed by the test. The test procedure expressly forbade external posting.

1. Creator called `publish_resource(kind="post")` with a workspace PNG, caption and alt text. The server created `res_7bd2f3becd5e@v1`, its image `res_017f287b9e24@v1`, and a resource chat card. This found and fixed a missing `resource` value in the server's message-kind validator; a regression test now covers native tool card creation.
2. Scheduler called `read_resource` and created `[DRAFT] Phase 11 real Scheduler verification`, `rt_2003ee542a96`, using native `trigger`: disabled, approval required, `resource_version=1`. Its prompt contained only the test procedure and no caption.
3. The person-facing API approved v1. Creator used `update_resource(base_version=1)` to create v2 with a different caption. v2 remained draft; the routine still referenced v1.
4. The test enabled the routine and ran it once. Run `rr_7ab535574e68` completed in 8.833 s with detail `res_7bd2f3becd5e@v1`. Scheduler confirmed the VERSION ONE caption and inspected the copied image under its workspace `.botteam/resources/res_017f287b9e24/v1/`. v2 was not used.
5. The routine was disabled again. Test objects were removed and each agent's original selected conversation was restored after recording the result.

The final run verified resource resolution, version pinning, approval and workspace image access using real engines. It did not publish to a social platform, so the resource stayed approved; the separate automated test verifies that `set_resource_status(..., published)` requires a currently running routine pinned to the exact approved version.

## Installation and operational behavior

`python-multipart` is required for resource uploads and recorded in `server/pyproject.toml` and `server/uv.lock`. Both install scripts already install locked server dependencies with `uv sync`; comments document this addition. README covers the new menu, tools, data paths, limits, tests and approval workflow. No new service, port, environment variable or manual installation step is needed.

Resource content lives below the configured data directory, uses relative database paths and is included in backup/restore. HTML uses `sandbox="allow-scripts"` without same-origin privileges and a restrictive response CSP. Existing social drafts are not migrated. Only recognized legacy workflow paragraphs are replaced, with a backup; custom instructions remain intact.
