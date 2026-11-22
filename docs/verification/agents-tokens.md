# Agents: reference measurements and implementation

Measured on 2026-11-22 against the authenticated agenticos 1.89.1 app at `http://100.79.177.78:3000/`, viewport 1500 × 1000. Read-only inspection covered the list, New agent dialog and all eight editor tabs. No reference agent was changed.

| Element | Reference | BotTeam |
| --- | --- | --- |
| List/editor heading | 24 px, weight 500 | `text-2xl font-medium` |
| List heading position | x 265, y 120.4, below announcement | 32 px inset from BotTeam's existing rail; no duplicate announcement |
| Editor heading position | x 333, y 158.4 | Same typography; robot and existing BotTeam navigation |
| New agent dialog | 672 px wide, 24 px padding, 16 px radius, white | max-width 672 px; 24 px padding; 16 px radius; skin composer surface |
| Card outline | rounded-xl, thin neutral border | 12 px radius, skin edge border |
| Card content | avatar/name, description, divider, status, edited date/actions | same hierarchy; BotTeam's colored robot |
| Controls | search then status; count aligned right | search, All/Active/Archived, optional section; count and Import on right |
| Editor navigation | horizontal tab strip, active underline | eight tabs, active underline, horizontal scrolling, arrow/Home/End keys |
| Editor blocks | white surface, subtle outline, collapsible sections | skin composer surface, edge border, collapsible details |
| Body/labels | approximately 14 px | 14 px, with secondary/tertiary skin ink |
| Primary action | dark fill, white text in light theme | ink fill/app text, inverted automatically by skin |

The light theme uses page `#fcfcfc`, composer `#ffffff`, ink `#1c1c1c` and the existing skin edge token. Dark and alternative skins retain their existing tokens. Grid breakpoints: one column below 850 px, two from 850 px, three from 1280 px; the existing rail occupies part of the viewport.

Intentional differences are specified in the Phase 9 plan: active/archived replaces publish/draft; Save replaces Publish; section replaces organization/category; Evals and Knowledge gaps remain empty; History shows conversations, costs and routine runs. Unsupported API/Slack/WhatsApp/embed endpoints show Soon. Robot colors remain BotTeam identities. All runtime integrations use existing BotTeam APIs.

Reference source pinned for imported templates: `vstorm-co/agenticos@a8c16d6b30571c636462e99a7221cf3724861057`. The 28 markdown files retain individual source/modification notices; Apache-2.0 is included beside them and attributed in root NOTICE.

Reference captures are local ignored artifacts in `web/e2e/actual/phase9-reference-*.png`, including the clean Agents list and eight editor tabs. Committed regression baselines use synthetic BotTeam data, so authenticated reference account details are not published.

## Toolbox follow-up (2026-11-22)

Reauthenticated and inspected the exact requested URL ending `?tab=toolbox`, including the Memory settings sheet. The current reference contains 35 capability cards grouped into seven shelves: Work with data, Chat channels, Knowledge and memory, Thinking and planning, The web, Everyday, Advanced. Each desktop card measures 216 × 210 px; illustration stage 96 px (80 px on phones); shelf gap 12 px; rounded corners 12 px. Search is 288 × 36 px. The right sheet is 672 px wide, full height, with a 56 px header and 20 px content inset. The gallery itself has one white bordered container, 20 px inset, shelf headers with enabled counts and horizontal paging arrows.

BotTeam now follows this gallery and sheet structure, using the reference's Apache-2.0 SVG illustrations with attribution and a local license. Connected apps is an additional card in Knowledge and memory, preserving BotTeam's existing assignment/access controls. Memory, Skills and Connected apps are backed by existing resources and the Agent draft/Save mechanism. Other reference capabilities are shown as Soon with disabled switches: BotTeam has no equivalent individual capability configuration/runtime integration yet. Reference tool counts and agent enablement were not copied, since they would not describe BotTeam. The reference's default “Never ask” policy is also not copied; BotTeam retains the configured approval policy in Limits. Memory's resource tabs are Settings/Notes, reflecting BotTeam's actual memory and note APIs.

Captures from the authenticated reference remain ignored as `toolbox-reference-current.png` and `toolbox-reference-memory-panel.png`. Published screenshots use synthetic agents. Visual regression adds gallery search and the Memory sheet; keyboard focus trapping/restoration, paging, search, unavailable states and Save semantics are covered by the browser test.
