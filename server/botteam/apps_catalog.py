"""The catalog behind "Connected apps": remote MCP servers that need only a token. (No Composio: the source of the catalog is this list; the
person pastes the token the app gives them, and it is kept like any other secret of a custom server.)"""
from __future__ import annotations

CATALOG: list[dict] = [
    {"id": "github", "name": "GitHub", "description": "Repositories, issues and pull requests", "url": "https://api.githubcopilot.com/mcp/", "transport": "http",
     "tokenLabel": "A personal access token", "tokenUrl": "https://github.com/settings/tokens"},
    {"id": "linear", "name": "Linear", "description": "Issues and projects", "url": "https://mcp.linear.app/mcp", "transport": "http",
     "tokenLabel": "A Linear API key", "tokenUrl": "https://linear.app/settings/api"},
    {"id": "notion", "name": "Notion", "description": "Pages and databases", "url": "https://mcp.notion.com/mcp", "transport": "http",
     "tokenLabel": "An integration token", "tokenUrl": "https://www.notion.so/profile/integrations"},
    {"id": "sentry", "name": "Sentry", "description": "Errors and releases", "url": "https://mcp.sentry.dev/mcp", "transport": "http",
     "tokenLabel": "An auth token", "tokenUrl": "https://sentry.io/settings/account/api/auth-tokens/"},
    {"id": "context7", "name": "Context7", "description": "Up-to-date library documentation", "url": "https://mcp.context7.com/mcp", "transport": "http",
     "tokenLabel": "", "tokenUrl": ""},
    {"id": "atlassian", "name": "Atlassian", "description": "Jira and Confluence", "url": "https://mcp.atlassian.com/v1/sse", "transport": "sse",
     "tokenLabel": "An API token", "tokenUrl": "https://id.atlassian.com/manage-profile/security/api-tokens"},
]


def by_id(app_id: str) -> dict | None:
    return next((a for a in CATALOG if a["id"] == app_id), None)
