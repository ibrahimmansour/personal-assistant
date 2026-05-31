---
name: version-bump
description: Use when bumping the package version, creating a release, or tagging a new version. Ensures both package.json and package-lock.json are updated together.
---

# Version Bump

When creating a new release, bumping a version, or tagging:

## Steps

1. Update `"version"` in `package.json` to the new version
2. Run `npm install --package-lock-only` to sync `package-lock.json`
3. Stage **both** files: `git add package.json package-lock.json`
4. Commit with the format: `chore: bump version to X.Y.Z` (or include it in the feature commit)
5. Push: `git push origin main`

## Rules

- NEVER commit `package.json` without also updating and committing `package-lock.json`
- ALWAYS run `npm install --package-lock-only` after editing the version in `package.json` to regenerate the lockfile
- Both files must be in the SAME commit
- Do NOT create or push tags locally — the GitHub Actions workflow detects the version bump and creates the tag + release automatically
