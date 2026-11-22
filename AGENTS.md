# Agent rules

1. **Consult the reference project** [agenticos](https://github.com/vstorm-co/agenticos) before designing or implementing a feature, and follow its behavior and structure unless there is a documented reason to differ. OpenMausBot is no longer a reference.
2. **Take the layout, styling and interactions of every screen from agenticos** (its screenshots and the plan in `docs/phase-8-workspace-layout.md`) before building or changing any screen. The old reference UI at `http://localhost:5199/` (OpenMausBot) is no longer used.
3. **Before pushing code to git, check `README.md`, `install.ps1` and `install.sh` and update them if the change calls for it.** That means: a new or changed feature, service, port, environment variable, command or script (`pnpm`/`start.bat`), folder layout, or a new prerequisite (a tool, runtime or dependency the install scripts must put on a new computer). If nothing needs changing, say so in the commit or the reply; do not leave them out of date.
