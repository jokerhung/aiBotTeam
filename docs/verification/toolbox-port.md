# Phase 10 port inventory

Source: the user's sibling checkout `D:/hungnm/github/aiSocialTeam`, revision `d832236` at inspection. Phase 9 is already committed in aiBotTeam as `7fae40d`, satisfying the prerequisite for 10.1. Reference app authenticated and inspected on 2026-11-22: Subagents, Web browser and Computer use settings; ignored captures are under `web/e2e/actual/phase10-reference-*.png`. No reference agent settings were changed.

| Area | Files reused/adapted | Adaptation |
| --- | --- | --- |
| Web host | `browser_host.py`, `browser_egress.py` | per-agent Toolbox settings, preserved profile/control lifecycle and protected CDP ports, per-agent idle interval |
| Web tools | `browser_mcp.py` | pinned Playwright MCP 0.0.86; removed COMPOSE_PATHS, compose_page and all postVia/Composio publishing policy |
| Computer | `computer_provider.py`, `computer_opensandbox.py`, `computer_host.py`, `computer_settings.py`, `computer_mcp.py`, `computer_stream.py` | independent Computer/Web capabilities; optional SDKs; no social campaign coupling |
| MCP transport | surface-entry helpers from `mcp_servers.py`, broker transport from `mcp_proxy.py`, browser/computer channels in `broker.py` | preserve aiBotTeam's current app caching/read/write controls; secrets remain in private spec files |
| Frontend reference | sibling `components/browser/*` and setup guide; agenticos capability settings/workbench | adapt to aiBotTeam's editor draft and explicit Save; global Computer host settings separated from per-agent controls |
| Setup docs | E2B/OpenSandbox English/Vietnamese guides and `opensandbox-desktop/` | adapt repository names; host provisioning remains user managed; no VM installer added |
| Tests | sibling BrowserEgress, BrowserHost and computer fake-provider tests | remove social publishing assumptions; add Toolbox enforcement, migration and Subagents tests |

No license file is present in the sibling checkout; it is a user-specified source for this port. Existing agenticos illustration/template licenses remain in place. External SDK/package licenses and new dependencies will be documented with their integrations.

Preparation checks: Microsoft Edge is installed and was used for authenticated reference inspection. `npx -y @playwright/mcp@0.0.86 --help` succeeds. Docker server 29.6.2 is reachable. No Computer host/key is configured in this BotTeam installation; the choice of live-test host has been requested while independent implementation continues. Never record credentials or raw configuration secrets in this file.

Implementation proceeds in plan order: validated model/migration and server tool gates, delegation lifecycle, surface host/API integration, frontend settings and final verification. Test status and live probe results belong in `toolbox.md`.

## Creator Computer liveview check (2026-11-23)

Ran `node web/e2e/computer-liveview.mjs` against the configured Creator Agent on the existing OpenSandbox host. Enabled Creator Computer use (it was off), woke its desktop, verified actual nonblank noVNC frames in chat, confirmed compact mode exposes only Expand, expanded and took control, opened a terminal using the preview keyboard handler and printed `BOTTEAM_COMPUTER_LIVEVIEW_TEST` using the preview text input. Inspected the direct desktop screenshot and confirmed the command output. Hand-back cleared the server control lock; the preview also rendered in SocialTeam project with no browser JavaScript errors. The machine was paused after testing and Creator Computer remains enabled. Evidence (ignored local captures): `web/e2e/actual/creator-computer-inline.png`, `creator-computer-input.png`, `creator-computer-expanded.png`, `creator-computer-project.png`. This verifies human takeover and live rendering; it does not claim an autonomous publishing run.
