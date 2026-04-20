#!/bin/sh
set -e

# Generate store.docker.yml from environment variables if PEERS_DB_DSN is set.
# This overrides the baked-in store config (store.yml / store.local.yml)
# via hierarchy-merge, since store.docker.yml is appended last in includes.

if [ -n "$PEERS_DB_DSN" ]; then
  cat > /app/conf/store.docker.yml <<EOF
peers:
  store:
    rds:
      gorm:
        - name: postgres
          driver: postgres
          enable: true
          default: true
          dsn: ${PEERS_DB_DSN}
        - name: ai_chat
          driver: postgres
          enable: true
          default: false
          dsn: ${PEERS_DB_DSN}
        - name: oss
          driver: postgres
          enable: true
          default: false
          dsn: ${PEERS_DB_DSN}
        - name: applet_store
          driver: postgres
          enable: true
          default: false
          dsn: ${PEERS_DB_DSN}
        - name: launcher
          driver: postgres
          enable: true
          default: false
          dsn: ${PEERS_DB_DSN}
EOF

  # Append store.docker.yml to peers.yml includes (last wins with hierarchy-merge)
  if ! grep -q 'store.docker.yml' /app/conf/peers.yml; then
    sed -i "s|\(includes:.*\)|\1, store.docker.yml|" /app/conf/peers.yml
  fi
fi

exec "$@"
