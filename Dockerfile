# syntax=docker/dockerfile:1
FROM debian:bookworm-slim

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV DEBIAN_FRONTEND=noninteractive

RUN set -eux; \
    apt-get update; \
    apt-get upgrade -y; \
    apt-get install -y --no-install-recommends \
      apt-transport-https \
      ca-certificates \
      curl \
      gnupg \
      lsb-release \
      bash \
      less \
      coreutils \
      gh \
      jq \
      gosu \
      iptables \
      kmod \
      iproute2 \
      tini; \
    install -m 0755 -d /etc/apt/keyrings; \
    curl -fsSL https://download.docker.com/linux/debian/gpg \
      | gpg --dearmor -o /etc/apt/keyrings/docker.gpg; \
    chmod a+r /etc/apt/keyrings/docker.gpg; \
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      > /etc/apt/sources.list.d/docker.list; \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg; \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      docker-ce \
      docker-ce-cli \
      containerd.io \
      docker-buildx-plugin \
      docker-compose-plugin \
      nodejs; \
    rm -rf /var/lib/apt/lists/*

# Install Git 2.53.0 from source (bookworm packages are older),
# then remove build-only dependencies to reduce attack surface.
RUN set -eux; \
    GIT_VERSION="2.53.0"; \
    BUILD_DEPS="build-essential gettext libcurl4-gnutls-dev libexpat1-dev libssl-dev zlib1g-dev xz-utils"; \
    apt-get update; \
    apt-get install -y --no-install-recommends $BUILD_DEPS; \
    curl -fsSL "https://mirrors.edge.kernel.org/pub/software/scm/git/git-${GIT_VERSION}.tar.xz" -o /tmp/git.tar.xz; \
    tar -xJf /tmp/git.tar.xz -C /tmp; \
    make -C "/tmp/git-${GIT_VERSION}" prefix=/usr/local -j"$(nproc)" all; \
    make -C "/tmp/git-${GIT_VERSION}" prefix=/usr/local install; \
    git --version | grep -q "2.53.0"; \
    rm -rf "/tmp/git-${GIT_VERSION}" /tmp/git.tar.xz; \
    apt-get purge -y --auto-remove $BUILD_DEPS; \
    rm -rf /var/lib/apt/lists/*

# Install Cursor Agent CLI (beta) into root user environment.
RUN set -eux; \
    curl -fsSL https://cursor.com/install | bash; \
    ln -sf /root/.local/bin/agent /usr/local/bin/agent; \
    ln -sf /root/.local/bin/cursor-agent /usr/local/bin/cursor-agent; \
    if [ -x /usr/local/bin/agent ]; then \
      /usr/local/bin/agent --version >/dev/null 2>&1 || true; \
    else \
      echo "Cursor agent installation failed: 'agent' binary missing" >&2; \
      exit 1; \
    fi

ENV PATH="/root/.local/bin:${PATH}" \
    DIND_HOME_PATH="/.vibeboyrunner" \
    DIND_WORKDIR_PATH="/workdir" \
    DIND_WORKSPACES_PATH="/workdir/workspaces" \
    AGENT_PROVIDERS="cursor" \
    BOOTSTRAP_AGENTS_PATH="/opt/vbr-bootstrap/agents"

WORKDIR /workdir

COPY agents /opt/vbr-bootstrap/agents
COPY manager /vibeboyrunner/services/manager
COPY entrypoint.sh /usr/local/bin/vbr-dind-entrypoint.sh
RUN chmod +x /usr/local/bin/vbr-dind-entrypoint.sh

RUN useradd -m -s /bin/bash -u 1000 vbr
USER vbr

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/vbr-dind-entrypoint.sh"]
CMD ["dockerd", "--host=unix:///var/run/docker.sock", "--storage-driver=vfs"]
