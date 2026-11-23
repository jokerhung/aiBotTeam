# The desktop image BotTeam uses for Computer use on OpenSandbox (docs/opensandbox-setup.en.md).
#
# Build it on the machine that runs the OpenSandbox server:
#   docker build -t botteam/desktop:1 docs/opensandbox-desktop
#
# It is based on OpenSandbox's examples/desktop image (Apache-2.0) and adds what BotTeam's computer tools need:
# xdotool and scrot (mouse, keyboard, screenshots), xclip (pasting text that is not ASCII, such as Vietnamese), Chrome, and
# a start script that brings up the display, the desktop and the view-only screen stream.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg locales \
        xvfb x11vnc x11-utils x11-xserver-utils xdotool scrot xclip \
        xfce4 xfce4-terminal dbus-x11 xterm \
        novnc python3-websockify procps net-tools \
        fonts-dejavu-core fonts-noto-core fonts-noto-color-emoji fonts-liberation \
    && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
        > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && apt-get remove -y xfce4-screensaver light-locker 2>/dev/null; apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# gtk-launch opens an application by its desktop name (computer_launch).
RUN apt-get update && apt-get install -y --no-install-recommends libgtk-3-bin && rm -rf /var/lib/apt/lists/*

# Chrome inside a container: no user namespaces for its own sandbox (the container is the sandbox) and a small /dev/shm.
RUN printf '%s\n' '#!/bin/sh' \
        'exec /usr/bin/google-chrome-stable --no-sandbox --disable-dev-shm-usage --no-first-run --no-default-browser-check "$@"' \
        > /usr/local/bin/google-chrome-stable \
    && chmod 755 /usr/local/bin/google-chrome-stable \
    && ln -s /usr/local/bin/google-chrome-stable /usr/local/bin/google-chrome

COPY botteam-desktop-start /usr/local/bin/botteam-desktop-start
RUN chmod 755 /usr/local/bin/botteam-desktop-start \
    && mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

# Machine files live in /home/user (BotTeam copies files to and from /home/user and /tmp).
RUN (userdel -r ubuntu 2>/dev/null || true) \
    && groupadd -g 1000 user && useradd -m -u 1000 -g user -G audio,video -s /bin/bash user

USER user
WORKDIR /home/user
ENV HOME=/home/user DISPLAY=:0

CMD ["bash"]
