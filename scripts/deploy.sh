#!/bin/sh
# Builds the site and publishes it as the single commit of the gh-pages branch, which GitHub Pages serves.
# Usage: npm run deploy [-- <remote name or URL>]   (default: origin)
set -e
remote="${1:-origin}"
url=$(git remote get-url "$remote" 2>/dev/null || echo "$remote")
rev=$(git rev-parse --short HEAD)
npm run build
cd dist
# Serve files exactly as built, without Jekyll processing.
touch .nojekyll
rm -rf .git
git init -q
git checkout -q -b gh-pages
git add -A
git commit -q -m "Deploy $rev"
git push -f -q "$url" gh-pages
rm -rf .git
echo "Deployed $rev to gh-pages"
