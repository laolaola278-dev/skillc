# gitguard

Zero-dependency pre-commit / pre-push guard that keeps **personal-environment fingerprints**
out of your public repositories: local absolute paths, usernames, private provider names,
API keys, private-key blocks. Runs before anything reaches GitHub.

Built because existing tools (gitleaks, git-secrets, detect-secrets, trufflehog) focus on
credentials and API tokens — none of them catch the things that actually leak personal
context: `C:\Users\...` paths, `D:\npm\global\...` install paths, or your own private
provider names. gitguard fills that gap with a small, configurable, zero-dependency CLI.

## Install

Global (so hooks work from any repo):

    npm link            # from this directory
    gitguard --version

Or run straight from the repo without installing:

    node guard/cli.mjs check --dir <repo>

## Usage

    gitguard check [--staged] [--dir <repo>] [--files <path...>]   scan; exit 1 on errors
    gitguard install [--force] [--dir <repo>]                      install pre-commit + pre-push hooks
    gitguard uninstall [--dir <repo>]                             remove gitguard hooks
    gitguard config                                               print effective rules

`gitguard install` writes two hooks into `.git/hooks`:

- **pre-commit** — scans staged files; blocks the commit on any error-level hit
- **pre-push** — scans all tracked files; blocks the push even if a leak was committed earlier

## Built-in rules

| id | level | catches |
|---|---|---|
| win-drive-path | error | `C:\...`, `D:\...` Windows drive-letter absolute paths |
| win-user-profile | error | `C:\Users\<name>` profile paths (leaks local username) |
| github-token | error | `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` tokens |
| sk-style-key | error | OpenAI-style `sk-...` keys |
| aws-access-key | error | `AKIA...` access key ids |
| private-key-block | error | `-----BEGIN ... PRIVATE KEY-----` blocks |
| unix-home | warning | `~/...` paths (often intended in docs) |
| assign-secret | warning | `token =`, `api_key =`, `password =` assignments |

## Configuration

Add `gitguard.json` next to `.git`:

```json
{
  "disabled": ["assign-secret"],
  "ignore": ["test/", "vendor/"],
  "skip": [
    { "file": "docs/", "line": ">\\*C:" }
  ],
  "rules": [
    { "id": "my-provider", "level": "error", "pattern": "myprivateprovider\\.ai", "msg": "private provider name" }
  ]
}
```

- `disabled` — rule ids to turn off entirely
- `ignore` — file/dir prefixes to skip (e.g. test fixtures that legitimately contain path-shaped strings)
- `skip` — skip a line when it matches a regex, for files under a prefix (e.g. docs that intentionally show deny patterns like `>*C:\*`)
- `rules` — your own patterns, error or warning level

## Example

    $ gitguard check --staged
    x [error] src/deploy.ps1:4  win-user-profile — Windows user profile leaks local username
        $HOME = C:\Users\<username>\AppData
    x [error] src/config.ts:9  sk-style-key — OpenAI-style API key
        const key = "sk-<redacted>"
    2 hit(s) in staged files — 2 error(s), 0 warning(s)
    gitguard: blocking — fix the files or configure gitguard.json

## License

MIT
