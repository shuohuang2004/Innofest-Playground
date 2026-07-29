# PR Lie Detector MVP

PR Lie Detector is a hackathon MVP for code review productivity. It compares what a pull request says with what the git diff actually changes, then renders a Markdown report that is shaped like a GitHub PR comment.

The important direction: this is meant to become a PR comment workflow. The CLI exists first so the scanner and report are easy to demo and test.

## What It Does

- Scans a PR diff for hard facts: changed controllers, services, routes, migrations, tests, docs, dependencies, CI files, and frozen legacy paths.
- Flags claim mismatches such as "refactor only" when the diff includes behavior-change signals.
- Generates a Truth Score, Evidence Board, Reviewer Questions, and a "Make It Honest" PR description.
- Uses OpenAI when `OPENAI_API_KEY` is present.
- Falls back to a rule-based report when there is no API key.

## Quick Start

Fast demo with bundled sample data:

```sh
node ./bin/pr-lie-detector.js --sample risky-refactor --no-ai
```

From this folder:

```sh
node ./bin/pr-lie-detector.js \
  --repo /home/eason/pic-collage-server \
  --base origin/dev \
  --head HEAD \
  --title "Refactor template update service" \
  --output report.md
```

If `origin/dev` is not available locally, use an explicit range:

```sh
node ./bin/pr-lie-detector.js \
  --repo /home/eason/pic-collage-server \
  --range HEAD~1...HEAD \
  --title "Refactor template update service"
```

## AI Mode

Set an API key to enable semantic claim checking and better PR description rewriting.

Gemini is the default provider in the bundled GitHub workflows:

```sh
export GEMINI_API_KEY="..."
export PR_LIE_DETECTOR_AI_PROVIDER="gemini"
export PR_LIE_DETECTOR_MODEL="gemini-3.6-flash"
```

For the GitHub demo repo:

```sh
gh secret set GEMINI_API_KEY --repo shuohuang2004/Innofest-Playground --body "..."
```

OpenAI is still supported:

```sh
export OPENAI_API_KEY="..."
export PR_LIE_DETECTOR_AI_PROVIDER="openai"
export PR_LIE_DETECTOR_MODEL="gpt-4.1-mini"
```

Without `GEMINI_API_KEY` or `OPENAI_API_KEY`, the tool still runs in rule-based mode.

Use `--no-ai` to force rule-based mode:

```sh
node ./bin/pr-lie-detector.js --repo /path/to/repo --range main...HEAD --no-ai
```

## Output For PR Comments

The Markdown output starts with this hidden marker:

```html
<!-- pr-lie-detector:report -->
```

That makes it easy for a future GitHub Action to create or update one stable PR comment instead of spamming new comments.

You can already update a stable GitHub PR comment with:

```sh
GITHUB_TOKEN="..." \
node ./bin/pr-lie-detector-comment.js \
  --github-repo owner/repo \
  --pr 123 \
  --body-file report.md
```

## GitHub Action Trigger Modes

There are two GitHub Action templates in `examples/github-actions/`:

- `pr-lie-detector-comment-trigger.yml`: runs only when someone comments `/lie-detect` on a PR.
- `pr-lie-detector-auto.yml`: runs automatically when a PR is opened, edited, synchronized, or reopened.
- `pr-lie-detector-review-gate.yml`: runs when review is requested and blocks reviewer assignment when the Truth Score is below 70.

For the hackathon demo, the comment-trigger mode is the most fun:

```text
Reviewer comments: /lie-detect
Action wakes up
Detector scans the PR branch
Action updates one stable PR Lie Detector comment
```

The workflow uses `issue_comment` because PR comments are issue comments in GitHub Actions:

```yaml
on:
  issue_comment:
    types: [created]
```

The job guard keeps it limited to PR comments that include `/lie-detect`:

```yaml
if: ${{ github.event.issue.pull_request && contains(github.event.comment.body, '/lie-detect') }}
```

The current template checks out the target repo and this detector separately:

```yaml
- uses: actions/checkout@v4
  with:
    path: repo

- uses: actions/checkout@v4
  with:
    repository: your-org/pr-lie-detector-mvp
    path: detector
```

Replace `your-org/pr-lie-detector-mvp` after this MVP is pushed somewhere. If you later vendor the detector into the backend repo, remove the second checkout and change `node detector/bin/...` to the vendored path.

Minimal final flow:

```yaml
name: PR Lie Detector

on:
  issue_comment:
    types: [created]

jobs:
  truth-report:
    if: ${{ github.event.issue.pull_request && contains(github.event.comment.body, '/lie-detect') }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
      pull-requests: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      # See examples/github-actions/pr-lie-detector-comment-trigger.yml for the full version.
```

The final version should update the existing marker comment instead of posting a new one each run.

## Review Gate

GitHub does not provide a native "prevent someone from clicking Request review" rule. The practical version is:

1. Someone requests review.
2. GitHub emits a `pull_request` event with type `review_requested`.
3. PR Lie Detector generates `report.json` and `report.md`.
4. If `ruleReport.truthScore < 70`, the review gate removes that requested reviewer/team through the GitHub API.
5. The same PR Lie Detector comment is updated with the gate result.
6. The workflow can fail, so branch protection can block merge until the PR is made more honest.

Local gate demo:

```sh
node ./bin/pr-lie-detector.js --sample risky-refactor --no-ai --json sample-report.json --output sample-report.md
node ./bin/pr-lie-detector-review-gate.js --report-json sample-report.json --report-md sample-report.md --threshold 70 --fail
```

The second command exits non-zero because the sample Truth Score is below 70.

## Tests

```sh
node --test ./test/rules.test.js
```

`npm test` also works in a normal local checkout. In this Codex desktop WSL/UNC workspace, direct `node --test` is more reliable because Windows `cmd.exe` does not keep UNC paths as the working directory.
