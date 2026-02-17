#!/bin/bash
# =============================================================================
# Praxrr Container Entrypoint
# =============================================================================
# Handles PUID/PGID/UMASK setup for proper file permissions
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}
UMASK=${UMASK:-022}

# -----------------------------------------------------------------------------
# Resolve group - use existing GID or create/modify group
# -----------------------------------------------------------------------------
if getent group "${PGID}" > /dev/null 2>&1; then
    # GID already taken - use that group
    APP_GROUP=$(getent group "${PGID}" | cut -d: -f1)
elif ! getent group praxrr > /dev/null 2>&1; then
    # GID free, praxrr doesn't exist - create it
    groupadd -g "${PGID}" praxrr
    APP_GROUP=praxrr
else
    # GID free, but praxrr exists with wrong GID - modify it
    groupmod -g "${PGID}" praxrr 2>/dev/null || true
    APP_GROUP=praxrr
fi

# -----------------------------------------------------------------------------
# Resolve user - use existing UID or create/modify user
# -----------------------------------------------------------------------------
if getent passwd "${PUID}" > /dev/null 2>&1; then
    # UID already taken - use that user
    APP_USER=$(getent passwd "${PUID}" | cut -d: -f1)
    usermod -g "${APP_GROUP}" "${APP_USER}" 2>/dev/null || true
elif ! getent passwd praxrr > /dev/null 2>&1; then
    # UID free, praxrr doesn't exist - create it
    useradd -u "${PUID}" -g "${APP_GROUP}" -d /config -s /bin/bash praxrr
    APP_USER=praxrr
else
    # UID free, but praxrr exists with wrong UID - modify it
    usermod -u "${PUID}" -g "${APP_GROUP}" praxrr 2>/dev/null || true
    APP_USER=praxrr
fi

# -----------------------------------------------------------------------------
# Set umask
# -----------------------------------------------------------------------------
umask "${UMASK}"

# -----------------------------------------------------------------------------
# Create config directory structure
# -----------------------------------------------------------------------------
mkdir -p /config/data /config/logs /config/backups /config/databases

# -----------------------------------------------------------------------------
# Fix ownership of config directory
# -----------------------------------------------------------------------------
chown -R "${PUID}:${PGID}" /config

# -----------------------------------------------------------------------------
# Drop privileges and run
# -----------------------------------------------------------------------------
exec gosu "${APP_USER}" /app/praxrr
