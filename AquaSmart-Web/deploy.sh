#!/usr/bin/env bash
# ============================================================================
# AquaSmart Irrigation Web Dashboard — One-Command Firebase Cloud Deployer
# Usage:
#   ./deploy.sh <firebase-project-id> [firebase-realtime-database-url]
# Example:
#   ./deploy.sh silicore-aquasmart https://silicore-aquasmart-default-rtdb.firebaseio.com
# ============================================================================

set -e

# Always run from the directory where this script is located
cd "$(dirname "$0")"

PROJECT_ID="${1:-}"
CUSTOM_DB_URL="${2:-}"

echo "========================================================"
echo "  AquaSmart Web & Cloud — Firebase Production Deployer"
echo "========================================================"

# Check if user is logged into Firebase CLI; if not, trigger login
echo "→ Checking Firebase authentication..."
if ! npx -y firebase-tools login:list 2>&1 | grep -q "@"; then
  echo "→ Opening browser to log into your Google Firebase account..."
  npx -y firebase-tools login
fi

if [ -z "$PROJECT_ID" ]; then
  echo ""
  echo "Usage: ./deploy.sh <firebase-project-id> [firebase-rtdb-url]"
  echo "Example:"
  echo "  1. Create a free project & Realtime Database at https://console.firebase.google.com"
  echo "  2. Run: ./deploy.sh silicore-aquasmart https://silicore-aquasmart-default-rtdb.firebaseio.com"
  echo ""
  echo "Logging in & listing your existing Firebase projects..."
  npx -y firebase-tools login
  npx -y firebase-tools projects:list
  exit 0
fi

# Determine the Realtime Database URL to bake into web/js/firebase-config.js
if [ -n "$CUSTOM_DB_URL" ]; then
  DB_URL="${CUSTOM_DB_URL%/}"
else
  EXISTING_URL=$(node -e "
    const fs = require('fs');
    const txt = fs.readFileSync('web/js/firebase-config.js', 'utf8');
    const m = txt.match(/databaseUrl:\s*['\"]([^'\"]*)['\"]/);
    process.stdout.write(m ? m[1].trim() : '');
  ")
  if [ -n "$EXISTING_URL" ]; then
    DB_URL="${EXISTING_URL%/}"
  else
    DB_URL="https://${PROJECT_ID}-default-rtdb.firebaseio.com"
  fi
fi

# Bake projectId and databaseUrl into web/js/firebase-config.js so ALL customer phones connect automatically
node -e "
  const fs = require('fs');
  const file = 'web/js/firebase-config.js';
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/databaseUrl:\s*['\"][^'\"]*['\"]/, \"databaseUrl: '${DB_URL}'\");
  content = content.replace(/projectId:\s*['\"][^'\"]*['\"]/, \"projectId: '${PROJECT_ID}'\");
  fs.writeFileSync(file, content, 'utf8');
"

echo "✓ Configured web/js/firebase-config.js -> Database URL: $DB_URL"

cat > .firebaserc <<EOF
{
  "projects": {
    "default": "$PROJECT_ID"
  }
}
EOF

echo "✓ Configured .firebaserc with project: $PROJECT_ID"

echo "→ Deploying permanent Realtime Database rules (database.rules.json)..."
if ! npx -y firebase-tools deploy --only database --project "$PROJECT_ID"; then
  echo "⚠ Note: Could not auto-deploy database.rules.json yet (make sure you clicked 'Create Database' under Build -> Realtime Database in Firebase Console)."
fi

echo "→ Deploying /web to https://$PROJECT_ID.web.app ..."
npx -y firebase-tools deploy --only hosting --project "$PROJECT_ID"

echo ""
echo "========================================================"
echo "  Deployment Complete!"
echo "  Live Website URL:  https://$PROJECT_ID.web.app"
echo "  Cloud Database:    $DB_URL"
echo "========================================================"
