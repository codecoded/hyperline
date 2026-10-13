#!/bin/sh
# Builds the game and force-pushes dist/ to the gh-pages branch (GitHub Pages).
set -e
cd "$(dirname "$0")/.."
remote=$(git remote get-url origin)
npx vite build
touch dist/.nojekyll
cd dist
git init -q -b gh-pages
git add -A
git commit -q -m "Deploy HYPERLINE build"
git push -q -f "$remote" gh-pages
rm -rf .git
echo "Deployed. Pages usually updates within a minute."
