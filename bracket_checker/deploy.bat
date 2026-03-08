@echo off
node build.js
npx wrangler pages deploy dist --project-name=bracket-checker
