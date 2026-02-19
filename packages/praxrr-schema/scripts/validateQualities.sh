#!/bin/bash
# validateQualities.sh - Validates qualities against Radarr and Sonarr source

set -e

RADARR_URL="https://raw.githubusercontent.com/Radarr/Radarr/develop/src/NzbDrone.Core/Qualities/Quality.cs"
SONARR_URL="https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/NzbDrone.Core/Qualities/Quality.cs"
QUAL_FILE="ops/2.qualities.sql"

echo "Fetching Radarr qualities..."
RADARR_QUALS=$(curl -s "$RADARR_URL" | grep -oP 'public static Quality \w+ => new Quality\(\d+, "\K[^"]+' | sort -u)
echo "Found Radarr qualities:"
echo "$RADARR_QUALS"
echo ""

echo "Fetching Sonarr qualities..."
# Sonarr has both => and getter patterns
SONARR_CONTENT=$(curl -s "$SONARR_URL")
SONARR_ARROW=$(echo "$SONARR_CONTENT" | grep -oP 'public static Quality \w+ => new Quality\(\d+, +"?\K[^",]+')
SONARR_GETTER=$(echo "$SONARR_CONTENT" | grep -oP 'return new Quality\(\d+, "\K[^"]+')
SONARR_QUALS=$(echo -e "$SONARR_ARROW\n$SONARR_GETTER" | grep -v '^$' | sort -u)

echo "Found Sonarr qualities:"
echo "$SONARR_QUALS"
echo ""

# Map Sonarr's remux naming to Radarr's
SONARR_QUALS=$(echo "$SONARR_QUALS" | sed 's/Bluray-1080p Remux/Remux-1080p/' | sed 's/Bluray-2160p Remux/Remux-2160p/' | sort -u)

echo "Extracting qualities from schema..."
SCHEMA_QUALS=$(grep -oP "(?<=\(')[^']+(?='\))" "$QUAL_FILE" | sort -u)

echo ""
echo "=== Radarr Validation ==="
RADARR_MISSING=$(comm -23 <(echo "$RADARR_QUALS") <(echo "$SCHEMA_QUALS"))
if [ -n "$RADARR_MISSING" ]; then
    echo "✗ Missing Radarr qualities:"
    echo "$RADARR_MISSING"
    exit 1
else
    echo "✓ All Radarr qualities present ($(echo "$RADARR_QUALS" | wc -l))"
fi

echo ""
echo "=== Sonarr Validation ==="
SONARR_MISSING=$(comm -23 <(echo "$SONARR_QUALS") <(echo "$SCHEMA_QUALS"))
if [ -n "$SONARR_MISSING" ]; then
    echo "✗ Missing Sonarr qualities:"
    echo "$SONARR_MISSING"
    exit 1
else
    echo "✓ All Sonarr qualities present ($(echo "$SONARR_QUALS" | wc -l))"
fi

echo ""
echo "Total unique qualities in schema: $(echo "$SCHEMA_QUALS" | wc -l)"