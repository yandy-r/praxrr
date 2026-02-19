#!/bin/bash
# validateLanguages.sh - Validates languages against Radarr and Sonarr source

set -e

RADARR_URL="https://raw.githubusercontent.com/Radarr/Radarr/develop/src/NzbDrone.Core/Languages/Language.cs"
SONARR_URL="https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/NzbDrone.Core/Languages/Language.cs"
LANG_FILE="ops/1.languages.sql"

echo "Fetching Radarr languages..."
RADARR_LANGS=$(curl -s "$RADARR_URL" | grep "public static Language" | grep -oP '=> new Language\(-?\d+, "\K[^"]+' | sort -u)
echo "Found Radarr languages:"
echo "$RADARR_LANGS"
echo ""

echo "Fetching Sonarr languages..."
SONARR_LANGS=$(curl -s "$SONARR_URL" | grep "public static Language" | grep -oP '=> new Language\(-?\d+, "\K[^"]+' | sort -u)
echo "Found Sonarr languages:"
echo "$SONARR_LANGS"
echo ""

echo "Extracting languages from schema..."
SCHEMA_LANGS=$(grep -oP "(?<=\(')[^']+(?='\))" "$LANG_FILE" | sort -u)

echo ""
echo "=== Radarr Validation ==="
RADARR_MISSING=$(comm -23 <(echo "$RADARR_LANGS") <(echo "$SCHEMA_LANGS"))
if [ -n "$RADARR_MISSING" ]; then
    echo "✗ Missing Radarr languages:"
    echo "$RADARR_MISSING"
    exit 1
else
    echo "✓ All Radarr languages present ($(echo "$RADARR_LANGS" | wc -l))"
fi

echo ""
echo "=== Sonarr Validation ==="
SONARR_MISSING=$(comm -23 <(echo "$SONARR_LANGS") <(echo "$SCHEMA_LANGS"))
if [ -n "$SONARR_MISSING" ]; then
    echo "✗ Missing Sonarr languages:"
    echo "$SONARR_MISSING"
    exit 1
else
    echo "✓ All Sonarr languages present ($(echo "$SONARR_LANGS" | wc -l))"
fi

echo ""
echo "Total unique languages in schema: $(echo "$SCHEMA_LANGS" | wc -l)"