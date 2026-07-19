#!/bin/sh
# Local preview server for the Jekyll site.
# Usage: npm run dev -- --port 4000   (extra args are passed to `jekyll serve`)

# Prefer the Homebrew Ruby (system Ruby on macOS is too old for this site)
if [ -d /opt/homebrew/opt/ruby/bin ]; then
  PATH="/opt/homebrew/opt/ruby/bin:$PATH"
fi

cd "$(dirname "$0")/.."

exec bundle exec jekyll serve --destination .jekyll-preview --watch "$@"
