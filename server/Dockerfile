# The relay on a container host (Fly.io, Railway, any Docker machine), which
# terminates TLS in front of it (server/deploy/README.md):
#   docker build -t stompy-relay server
#   docker run -p 8096:8096 -e STOMPY_ORIGINS=you.github.io stompy-relay
# Standard library only, so nothing to install.
FROM python:3.12-slim
WORKDIR /app
COPY server.py data.py loadout_tables.json names_deny.txt ./
# The host's proxy reaches it from a private address and says who the pilot
# is in X-Forwarded-For.
ENV STOMPY_HOST=0.0.0.0 STOMPY_PORT=8096 STOMPY_PROXY=private PYTHONUNBUFFERED=1
EXPOSE 8096
USER nobody
HEALTHCHECK --interval=30s --timeout=3s CMD ["python3", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8096/health', timeout=2)"]
CMD ["python3", "server.py"]
