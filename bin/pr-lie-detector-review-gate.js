#!/usr/bin/env node

import { existsSync } from 'node:fs';

import {
  appendGateSection,
  evaluateReviewGate,
  readJsonFile,
  removeRequestedReviewers,
  requestedReviewersFromEvent,
} from '../src/reviewGate.js';

main(process.argv.slice(2)).catch((error) => {
  console.error(`pr-lie-detector-review-gate failed: ${error.message}`);
  if (process.env.DEBUG) {
    console.error(error.stack);
  }
  process.exitCode = 1;
});

async function main(argv) {
  const options = parseArgs(argv);

  if (options.help) {
    console.log(helpText());
    return;
  }

  const report = readJsonFile(options.reportJson);
  const gate = evaluateReviewGate({
    report,
    threshold: options.threshold,
  });
  let removal = null;

  if (gate.blocked && options.mode === 'unrequest') {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

    if (!token) {
      throw new Error('Set GITHUB_TOKEN or GH_TOKEN before removing requested reviewers.');
    }

    const event = options.eventPath && existsSync(options.eventPath) ? readJsonFile(options.eventPath) : null;
    const requested = requestedReviewersFromEvent(event);

    removal = await removeRequestedReviewers({
      token,
      githubRepo: options.githubRepo,
      pr: options.pr,
      ...requested,
    });
  }

  appendGateSection({
    reportMdPath: options.reportMd,
    gate,
    removal,
  });

  console.log(`Review gate ${gate.status}: score ${gate.score}/100, threshold ${gate.threshold}.`);

  if (removal?.removed) {
    console.log(`Removed requested reviewers: ${[...removal.reviewers, ...removal.teamReviewers].join(', ')}`);
  } else if (removal?.reason) {
    console.log(removal.reason);
  }

  if (gate.blocked && options.fail) {
    process.exitCode = 1;
  }
}

function parseArgs(argv) {
  const options = {
    reportJson: 'report.json',
    reportMd: '',
    threshold: Number(process.env.PR_LIE_DETECTOR_REVIEW_THRESHOLD || 70),
    mode: 'check',
    githubRepo: process.env.GITHUB_REPOSITORY || '',
    pr: process.env.PR_NUMBER || '',
    eventPath: process.env.GITHUB_EVENT_PATH || '',
    fail: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--report-json':
        options.reportJson = takeValue(argv, ++index, arg);
        break;
      case '--report-md':
        options.reportMd = takeValue(argv, ++index, arg);
        break;
      case '--threshold':
        options.threshold = Number(takeValue(argv, ++index, arg));
        break;
      case '--mode':
        options.mode = takeValue(argv, ++index, arg);
        break;
      case '--github-repo':
        options.githubRepo = takeValue(argv, ++index, arg);
        break;
      case '--pr':
        options.pr = takeValue(argv, ++index, arg);
        break;
      case '--event-path':
        options.eventPath = takeValue(argv, ++index, arg);
        break;
      case '--fail':
        options.fail = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.threshold) || options.threshold < 0 || options.threshold > 100) {
    throw new Error('--threshold must be a number between 0 and 100.');
  }

  if (!['check', 'unrequest'].includes(options.mode)) {
    throw new Error('--mode must be check or unrequest.');
  }

  if (options.mode === 'unrequest' && (!options.githubRepo || !options.pr)) {
    throw new Error('--github-repo and --pr are required in unrequest mode unless GITHUB_REPOSITORY and PR_NUMBER are set.');
  }

  return options;
}

function takeValue(argv, index, flag) {
  const value = argv[index];

  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

function helpText() {
  return `PR Lie Detector Review Gate

Usage:
  pr-lie-detector-review-gate --report-json report.json --threshold 70 --fail
  pr-lie-detector-review-gate --mode unrequest --github-repo owner/repo --pr 123 --report-json report.json --report-md report.md

Modes:
  check      Reads the Truth Score and optionally fails when it is below threshold.
  unrequest  Removes the reviewer/team from a pull_request review_requested event when score is below threshold.

Environment:
  GITHUB_TOKEN or GH_TOKEN is required for --mode unrequest.
`;
}
