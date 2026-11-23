# OpenSandbox setup

Computer use is off by default. With OpenSandbox, each agent's computer is a Docker container with a desktop, made by an OpenSandbox server that you run yourself on a Linux machine. It needs only Docker: no KVM, no virtual machines. BotTeam talks to the server's address and, if you set one, its API key. Choose OpenSandbox (Docker) in Settings → Computer Use, and turn Computer use on for an agent only after the connection test reports that the computer host is ready.

BotTeam requires Python 3.11 or later for this optional feature, as it does for E2B.

## Before you start

You need a Linux server with Docker Engine 27 or later, about 3 GB of free disk space for the desktop image, and outbound access to Docker Hub, Ubuntu's package archive and Google's Chrome repository while the image is built. A computer is a container, so 1–2 GB of memory per running computer is a sensible budget.

A container separates the computer from your server only as well as Docker does. The computers visit web pages that nobody has checked, so read the part about stronger isolation at the end before you put sign-ins on them.

## Install the OpenSandbox server

Install uv, then let it fetch the server and write a configuration for the Docker runtime. The first run downloads the server and its dependencies, which takes a few minutes on a slow link.

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
~/.local/bin/uvx opensandbox-server init-config ~/.sandbox.toml --example docker
```

Open `~/.sandbox.toml` and set these values under `[server]`. Use the address that BotTeam reaches, never `0.0.0.0` on a network you do not trust, and generate a long key with `openssl rand -hex 24`.

```toml
[server]
host = "192.0.2.10"        # the address BotTeam connects to (your LAN or Tailscale address)
port = 8080
eip = "192.0.2.10:8080"    # that address WITH the port: the server puts it in the addresses it hands out
api_key = "osk_your-long-random-key"

[egress]
mode = "dns+nft"          # limits the computers' network at the packet level (see below)
```

Without the port in `eip`, BotTeam cannot reach the computers' screens. With the default egress mode `dns` the server only filters domain names, so it cannot keep a computer away from private addresses: BotTeam needs `dns+nft`. (We measured it: with `dns+nft` a computer could not reach 192.168.x.x, the server's own address, the Docker gateway or another machine on the Tailscale network, while websites worked.)

Keep the file private (`chmod 600 ~/.sandbox.toml`). Then run the server as a service so that it starts with the machine. Replace `youruser` with the user that is in the `docker` group.

```bash
sudo tee /etc/systemd/system/opensandbox.service >/dev/null <<'EOF'
[Unit]
Description=OpenSandbox server (Docker runtime)
After=network-online.target docker.service
Requires=docker.service

[Service]
User=youruser
Group=docker
Environment=PATH=/home/youruser/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/youruser/.local/bin/uvx opensandbox-server --config /home/youruser/.sandbox.toml
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now opensandbox
curl http://192.0.2.10:8080/health
```

The last command prints `{"status":"healthy"}`. With the key set, `curl -H "OPEN-SANDBOX-API-KEY: <your key>" http://192.0.2.10:8080/v1/sandboxes` lists the sandboxes (none yet), and the same request without the key is refused.

## Build the desktop image

The image is made from `docs/opensandbox-desktop` in the BotTeam repository. Copy that folder to the server and build it there; the first build downloads Chrome and the desktop and can take ten minutes or more.

```bash
docker build -t botteam/desktop:1 docs/opensandbox-desktop
```

The image holds a desktop (Xvfb and XFCE), Chrome, `xdotool` and `scrot` for the agent's mouse, keyboard and screenshots, `xclip` for pasting text such as Vietnamese, and a view-only screen stream. Build it again when you want a newer Chrome.

## Connect BotTeam

Open Settings → Computer Use, choose OpenSandbox (Docker), enter the server URL (`http://192.0.2.10:8080`), the API key and the image name (`botteam/desktop:1`), and use Save and test connection. The test makes a real computer, checks the desktop tools, takes a screenshot and removes the computer again, so it takes some seconds.

The result is one of: ready; unauthorized (check the key); unreachable (check the address, the firewall and that the service runs); no desktop image (build it on the server); desktop tools missing (rebuild the image from the current folder); the server cannot limit the computer's network access (see Troubleshooting).

Only the server's port (8080) has to be reachable from the BotTeam machine. The computers' screens are streamed through the server with your API key, so you do not need to open any other port.

## What to expect

When a computer has been idle for the idle time you set, BotTeam freezes the container in place (Docker pause). Open windows and sign-ins stay, and it wakes in a few seconds. A frozen container still holds its memory, so keep the number of computers in line with the server's RAM (about 1–2 GB each). If the server cannot freeze a computer, or you restart or remove the container, the computer is made again from the image and the open windows and sign-ins are gone: sign in again by taking over the computer. E2B keeps everything because it snapshots memory to disk; OpenSandbox on Docker keeps it only while the container exists.

Each computer is blocked from reaching private networks and from your server and your BotTeam machine. If your OpenSandbox server cannot apply that, the computer is not made.

## Stronger isolation

By default a container shares the server's kernel. For pages you do not trust, run the OpenSandbox server with gVisor or Kata Containers: see "Secure Container Runtime" in the OpenSandbox documentation (docs/guides/secure-container.md in https://github.com/alibaba/OpenSandbox) and set `[secure_runtime]` in `~/.sandbox.toml`. Kata needs KVM; gVisor does not. Restart the service after you change the file.

## Windows

The OpenSandbox server needs Linux. On Windows run it inside a WSL2 Linux distribution that has Docker (Docker Desktop with WSL integration works) and follow the Linux steps there. This has not been verified on every Windows setup.

## Update and remove

To update, run `sudo systemctl restart opensandbox` after `~/.local/bin/uv tool upgrade opensandbox-server` (or let `uvx` fetch the newest release). To remove, delete the computers in BotTeam first, then `sudo systemctl disable --now opensandbox`, remove the unit file, `docker rmi botteam/desktop:1`, and delete `~/.sandbox.toml`.

## Troubleshooting

No desktop image: `docker images` on the server must list `botteam/desktop:1`. The server looks for it in its own Docker, and falls back to Docker Hub, where it does not exist.

Desktop tools missing: rebuild the image from the `docs/opensandbox-desktop` folder of this BotTeam version.

The server cannot limit the computer's network access: the egress sidecar image could not start, or `[egress] mode` is not `dns+nft`. Check `sudo journalctl -u opensandbox`, that the server can pull `opensandbox/egress` and `opensandbox/execd` from Docker Hub, and that Docker uses the bridge network.

The computer's screen is black: the desktop turns the screensaver off when a computer starts. If the screen is still black, take over the computer and press a key, then tell the agent.

Out of disk space: Docker keeps images and stopped containers. Run `docker system df` and `docker image prune` on the server.
