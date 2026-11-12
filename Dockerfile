# One image: the Python server plus the static web build it serves itself. Data lives in /data (a volume).
FROM node:22-slim AS web
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
RUN pnpm install --frozen-lockfile --filter web...
COPY web web
RUN BOTTEAM_EXPORT=1 pnpm --filter web exec next build

FROM python:3.12-slim
WORKDIR /app
COPY server /app/server
COPY --from=web /app/web/.next-export /app/server/botteam/webui
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv
RUN uv pip install --system --no-cache /app/server
ENV BOTTEAM_DATA_DIR=/data \
    BOTTEAM_HOST=0.0.0.0 \
    SERVER_PORT=8899 \
    WEBHOOK_PORT=8900 \
    PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 8899 8900
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8899/health')"
# listening on 0.0.0.0 means a browser must be paired: the code is printed in the container log (`docker compose logs botteam`)
CMD ["botteam", "serve", "--no-open"]
