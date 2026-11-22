# Phase 9 verification

The Agents list, creation dialog, eight-tab editor and offline template library are implemented. Card menus preserve the existing bot actions. Chat Settings/Edit Profile now open the editor; chat details contain Overview, Activity and Inspector. Notes moved to Toolbox → Memory, while the dedicated Computer panel remains available from chat.

Draft changes are compared only across editable fields. Runtime messages/busy state do not make the editor dirty. Save sends changed fields through the per-agent patch queue. Discard, external Reload/Keep mine, browser unload protection, canceled navigation and tab changes are covered by the browser flow. Subresources retain their own APIs and save buttons.

Validation commands:

```powershell
cd web
npx tsc --noEmit
npx eslint components/agents components/BotPanel.tsx components/layout/pages.tsx components/layout/useHashRoute.ts components/Shell.tsx components/useGlobalBehaviors.ts components/MemorySection.tsx components/SkillsSection.tsx state/store.tsx lib/agent-form.ts
npx vitest run
cd ..
server/.venv/Scripts/python.exe -m pytest server/tests/test_api.py server/tests/test_pack.py server/tests/test_agent_templates.py server/tests/test_phase3.py -q
$env:UV_NO_SYNC = '1'
node scripts/workspace-shots.mjs --workspace
node scripts/visual.mjs --update
node scripts/visual.mjs
```

The existing Python environment is used for browser fixtures because a running Windows installation can lock `botteam.exe` while uv attempts to reinstall the editable package after a packaging metadata change. No new dependency is needed. Normal installations still use the existing uv sync/build process.

Web unit tests cover filters, template search, routes, handles, reducer state and editable diffs/guards. Backend tests cover legacy null dates, create/edit timestamps, archive/restore, offline catalog shape, unknown template IDs and installation from every industry, including General.

The workspace browser check creates temporary persisted Echo agents through the UI, edits instructions and approval policy, saves/reloads/discards, checks a controlled Memory assignment, handles a concurrent API edit, traverses all tabs, executes a real Echo conversation, installs a template, duplicates, archives/restores and verifies typed deletion plus Undo. Layout checks cover editor, list and creation dialog at 360, 768, 1024 and 1440 px. Fixture agents and databases are removed afterward. Existing navigation, chat, Back/Forward/reload and mobile drawer checks also run.

The real-message smoke check uses Echo with actual API/database persistence, rather than invoking a paid CLI or changing a user's working agent. Existing Claude/Codex/Antigravity driver behavior is unchanged. No reference account credentials or real user conversations are included in screenshots.

31 screenshots cover existing approval/settings/chat skins and the Agents list, creation, templates and eight tabs. README screenshots and the editor image in the user guide are generated from a separate synthetic workspace.

README, install.ps1 and install.sh were reviewed. README and the user guide describe the feature; installation scripts need no change because there are no new prerequisites, services, ports, environment variables or setup commands. Wheel artifacts now include `botteam/templates/**` so installed servers retain the offline catalog.

Results: 61 web unit tests and 101 backend tests passed; TypeScript, scoped ESLint and the full workspace browser check passed. The screenshot comparison covers 31 screens; generated images contain synthetic data.

Production static export also passed with BOTTEAM_EXPORT=1 and npx next build. The existing CSS highlight optimizer warnings do not prevent compilation/export. Final comparison passed all 31 screens (maximum difference 0.024%, below the existing 0.3% threshold).

## Toolbox visual follow-up

The requested reference URL was reauthenticated and inspected directly, including its Memory sheet. The former three-card selector has been replaced by the seven-shelf illustrated gallery, using 35 reference catalog entries plus BotTeam's Connected apps card. Measurements, source attribution and intentional runtime differences are recorded in `agents-tokens.md`. The source SVG illustrations and scoped CSS are accompanied by Apache-2.0 attribution and license text.

Search, arrow paging, disabled Soon states, right-side resource panels, focus trapping/restoration, controlled Memory Save and layouts at 360/768/1024/1440 px were verified in the persisted Echo browser fixture. Notes, skills and connected-app access controls retain their existing APIs. Switching editor tabs resets scroll to the top while preserving the Agent draft. Unsupported capability settings are deliberately not simulated.

Validation: 63 web unit tests, TypeScript and scoped ESLint passed. Production static export passed. All 33 visual comparisons passed, including the new Toolbox search and Memory panel captures. The gallery, search and panel comparisons had 0% pixel difference; the existing Limits snapshot differed by 0.021%, below the 0.3% threshold. The synthetic Toolbox screenshot is included in the user guide. README and installer scripts were reviewed; no new dependency, prerequisite, service or port requires installer changes.
