#!/bin/bash

echo "🚀 Updating Welizium repository..."

git add .

if [ -z "$1" ]; then
  COMMIT_MSG="Auto update: $(date '+%Y-%m-%d %H:%M:%S')"
else
  COMMIT_MSG="$1"
fi

git commit -m "$COMMIT_MSG"

git push origin main

echo "✅ Repository updated successfully!"
