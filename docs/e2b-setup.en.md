# E2B setup

Computer use is off by default. Install the optional SDKs with `uv sync --project server --extra computer`. BotTeam requires Python 3.11 or later for this optional feature. Choose E2B Cloud or a self-hosted E2B server in Settings → Computer Use. After the connection reports ready, choose Computer use in the settings for an agent whose engine supports computer tool images.

If BotTeam currently uses Python 3.10, run `uv sync --project server --python 3.11` from the repository and restart the BotTeam server before enabling Computer use.

## E2B Cloud

Create an account at https://e2b.dev and copy an API key from the E2B dashboard. Select E2B Cloud, paste the key and use Save and test connection. The default template is `desktop`.

Screenshots and the contents of the virtual machine are processed on E2B infrastructure. Check your E2B plan for usage limits, run duration and pricing. Keep the key on the BotTeam server and use Take over when you need to sign in to a site.

## Self-hosting on Linux

Use a Linux machine with nested virtualization when it runs inside a VM. E2B recommends Ubuntu 24.04, kernel 6.8 or newer (6.10 on arm64), Docker Engine 27+, Compose 2.24+ and 12 GiB RAM. Check that both `/dev/kvm` and `/dev/net/tun` exist. The desktop build needs more disk than the base installation. On the aiSocialTeam reference test machine the build briefly needed over 40 GiB of free space. Start with at least 50 GiB free for the full template build and leave room for paused machines.

```bash
ls -l /dev/kvm /dev/net/tun
docker version
docker compose version
df -h /
mkdir e2b && cd e2b
runtime=2c662b902d061bee7b88d408477bed5d05107934
curl -fsSL --remote-name-all "https://raw.githubusercontent.com/e2b-dev/runtime/$runtime/embed/compose/{compose.yaml,.env}"
docker compose up -d --wait
eval "$(docker compose exec ready cat /run/e2b/sdk.env)"
```

Install Docker Engine from https://docs.docker.com/engine/install/ if it is missing. The Compose commands follow the E2B guide. The source aiSocialTeam tests used a source-based E2B runtime on a Linux Mint VMware guest with KVM.

Build the official desktop template on the E2B host so the template upload can reach the service on its local port. Run the following in the shell that already has the E2B SDK variables. The resource settings below match the VMware test.

```bash
git clone https://github.com/e2b-dev/desktop.git
cd desktop
git checkout 91f23acaab7312e847596acc44e6f7763f56917f
python3 -m venv .venv
.venv/bin/pip install e2b==2.64.0
cd template
../.venv/bin/python - <<'PY'
from e2b import Template, default_build_logger
from template import template_with_user_workdir
Template.build(template_with_user_workdir, name="desktop", cpu_count=2,
               memory_mb=2048, on_build_logs=default_build_logger())
PY
```

In BotTeam choose Self-hosted E2B. Enter the API URL with port 3000 and the sandbox proxy URL with port 3002 when BotTeam runs on another machine. For example, use `http://e2b-host:3000` and `http://e2b-host:3002` for a trusted DNS name inside your LAN or Tailscale. Paste the local E2B key and test the connection. Leave the domain field blank for an installation reached through those explicit URLs. Use the E2B domain setting when you have configured host-based sandbox routing.

Keep the API and sandbox proxy ports inside your trusted network. The optional E2B dashboard uses port 3001. Build uploads on port 5008 should stay on the E2B host. BotTeam relays the stream to the viewer through the app's own address.

## Self-hosting on Windows

Enable hardware virtualization in firmware, enable WSL2, install Docker Desktop with its WSL2 backend, and enable integration with Ubuntu 24.04. In your Windows user directory, create or edit `.wslconfig` and set `memory=16GB` and `nestedVirtualization=true` under `[wsl2]`. Apply the changes with `wsl --shutdown`, which stops all running WSL distributions and Docker containers. Restart Docker Desktop and Ubuntu.

Check `ls -l /dev/kvm /dev/net/tun` in Ubuntu. If KVM is missing, use a Linux host with KVM. The Windows 10 machine used in the aiSocialTeam reference test had no KVM in WSL2. A Linux VMware guest with nested virtualization provided E2B instead. Once KVM is present, use the Linux instructions from Ubuntu.

## Take over and troubleshooting

Open the agent's Computer tab. Wake starts or resumes the machine. Open large displays the live desktop. Take over enables input from your browser and pauses the agent's computer tools until you choose Hand back. Use the agent's settings to remove the virtual machine and clear its saved files and sign-ins. Deleting an agent also removes its machine.

If the template is missing, check its build status in E2B. If a build ran out of space, free disk and retry with `skip_cache=True` if it still references missing snapshots. For a hugepage allocation error, lower the concurrent computer limit or increase `HUGEPAGES` in the Compose settings. For `Failed to UFFD object`, check the kernel version and KVM support. If the browser cannot show the live image, make sure the BotTeam web proxy supports WebSockets and the server can reach both E2B URLs.

For updates and removal, follow the instructions for the version used to install E2B at https://github.com/e2b-dev/runtime/tree/2c662b902d061bee7b88d408477bed5d05107934/embed/compose.
