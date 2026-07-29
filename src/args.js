import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { UserFacingError } from './errors.js';

const DEFAULT_BASE = 'origin/dev';
const DEFAULT_HEAD = 'HEAD';

export function parseArgs(argv) {
  const options = {
    repo: process.cwd(),
    base: process.env.GITHUB_BASE_REF || DEFAULT_BASE,
    head: process.env.GITHUB_SHA || DEFAULT_HEAD,
    title: process.env.PR_TITLE || process.env.GITHUB_PR_TITLE || '',
    body: process.env.PR_BODY || process.env.GITHUB_PR_BODY || '',
    ai: process.env.PR_LIE_DETECTOR_AI_ENABLED !== 'false',
    model: process.env.PR_LIE_DETECTOR_MODEL || process.env.OPENAI_MODEL || '',
    maxDiffChars: Number(process.env.PR_LIE_DETECTOR_MAX_DIFF_CHARS || 14000),
    output: '',
    jsonOutput: '',
    githubComment: true,
    fallbackRange: 'HEAD~1...HEAD',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--repo':
        options.repo = takeValue(argv, ++index, arg);
        break;
      case '--base':
        options.base = takeValue(argv, ++index, arg);
        break;
      case '--head':
        options.head = takeValue(argv, ++index, arg);
        break;
      case '--range':
        options.range = takeValue(argv, ++index, arg);
        break;
      case '--sample':
        options.sample = takeValue(argv, ++index, arg);
        break;
      case '--fallback-range':
        options.fallbackRange = takeValue(argv, ++index, arg);
        break;
      case '--title':
        options.title = takeValue(argv, ++index, arg);
        break;
      case '--body':
        options.body = takeValue(argv, ++index, arg);
        break;
      case '--body-file':
        options.body = readTextFile(takeValue(argv, ++index, arg));
        break;
      case '--output':
      case '-o':
        options.output = takeValue(argv, ++index, arg);
        break;
      case '--json':
        options.jsonOutput = takeValue(argv, ++index, arg);
        break;
      case '--model':
        options.model = takeValue(argv, ++index, arg);
        break;
      case '--max-diff-chars':
        options.maxDiffChars = Number(takeValue(argv, ++index, arg));
        break;
      case '--no-ai':
        options.ai = false;
        break;
      case '--no-github-comment':
        options.githubComment = false;
        break;
      default:
        throw new UserFacingError(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.maxDiffChars) || options.maxDiffChars < 1000) {
    throw new UserFacingError('--max-diff-chars must be a number >= 1000');
  }

  options.repo = normalizeInputPath(options.repo);
  options.range = options.range || `${options.base}...${options.head}`;

  return options;
}

export function helpText() {
  return `PR Lie Detector MVP

Usage:
  pr-lie-detector --repo /path/to/repo --base origin/dev --head HEAD --title "Refactor template service"

Options:
  --repo <path>              Git repository to inspect. Defaults to cwd.
  --base <ref>               Base ref. Defaults to origin/dev or GITHUB_BASE_REF.
  --head <ref>               Head ref. Defaults to HEAD or GITHUB_SHA.
  --range <git-range>        Explicit git diff range, e.g. origin/dev...HEAD.
  --sample <name>            Use bundled demo data instead of a git repo. Try risky-refactor.
  --title <text>             PR title.
  --body <text>              PR body.
  --body-file <path>         Read PR body from a file.
  --output, -o <path>        Write Markdown report to a file.
  --json <path>              Write full report JSON to a file.
  --model <model>            AI model override. Defaults to provider-specific model.
  --max-diff-chars <number>  Diff excerpt budget for AI. Defaults to 14000.
  --no-ai                    Disable AI even if an API key exists.
  --no-github-comment        Omit the hidden PR-comment marker.
`;
}

function takeValue(argv, index, flag) {
  const value = argv[index];

  if (!value || value.startsWith('--')) {
    throw new UserFacingError(`${flag} requires a value`);
  }

  return value;
}

function readTextFile(path) {
  const resolved = normalizeInputPath(path);

  if (!existsSync(resolved)) {
    throw new UserFacingError(`File does not exist: ${resolved}`);
  }

  return readFileSync(resolved, 'utf8');
}

function normalizeInputPath(path) {
  if (process.platform === 'win32' && path.startsWith('/')) {
    return path;
  }

  return isAbsolute(path) ? path : resolve(path);
}
