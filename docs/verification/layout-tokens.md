# Workspace layout — measures

Taken from the agenticos screenshot (3200 x 2000, shown at 2000 x 1250) and used in `web/components/layout/AppRail.tsx`, `Sidebar.tsx` (chat list) and `PageFrame.tsx`.

| Part | agenticos (screenshot px at 2000 wide) | BotTeam |
|---|---|---|
| Left menu width | ~258 | 248 px (`w-[248px]`), 64 px collapsed |
| Chat list width | ~275 | existing sidebar width (240–480, 280 default), icons only below 1100 px |
| Menu row | ~38 high, 10 px icon gap, 14 px text | `h-[38px]`, `gap-2.5`, `text-[14px]` |
| Group label ("Build", "Knowledge") | small grey, ~12 px | `text-[12px] text-ink-tertiary`, `pt-4` above |
| Active row | filled rounded pill | `bg-raised text-ink`, `rounded-lg` |
| Search field | in the menu, with the key hint `⌘K` | `h-9`, `⌘K` hint, opens the command palette |
| Foot of the menu | bell, version badge, user card | bell, name (opens the profile menu), no version badge |
| Title bar of a page | ~60 high, title, actions on the right | `min-h-[60px]`, `text-[17px] font-semibold` |
| Page body | centred column | `max-w-[900px]` (`1100px` for the Agents table) |

Colours come from the existing skin tokens (`--color-panel`, `--color-app`, `--color-raised`, `--color-edge`), so all 13 skins keep working (`scripts/check-skin-contrast.mjs` passes for each).

Not copied from agenticos: the version badge (BotTeam has no single version number to show), the user's e-mail line, and the Activity, Tables and Context menu items (not requested).
