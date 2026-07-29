#!/usr/bin/env node

import { readFileSync } from 'node:fs';

import { githubJson } from '../src/githubClient.js';

const MARKER = '<!-- pr-lie-detector:report -->';

main(process.argv.slice(2)).catch((error) => {
  console.error(`pr-lie-detector-comment failed: ${error.message}`);
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

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

  if (!token) {
    throw new Error('Set GITHUB_TOKEN or GH_TOKEN before posting a PR comment.');
  }

  const body = readFileSync(options.bodyFile, 'utf8');

  if (!body.includes(MARKER)) {
    throw new Error(`Report is missing marker: ${MARKER}`);
  }

  const existing = await findExistingComment({
    token,
    repo: options.githubRepo,
    pr: options.pr,
  });

  if (existing) {
    await githubJson({
      token,
      method: 'PATCH',
      path: `/repos/${options.githubRepo}/issues/comments/${existing.id}`,
      body: { body },
    });
    console.log(`Updated PR Lie Detector comment ${existing.id}.`);
    return;
  }

  const created = await githubJson({
    token,
    method: 'POST',
    path: `/repos/${options.githubRepo}/issues/${options.pr}/comments`,
    body: { body },
  });
  console.log(`Created PR Lie Detector comment ${created.id}.`);
}

async function findExistingComment({ token, repo, pr }) {
  const comments = await githubJson({
    token,
    method: 'GET',
    path: `/repos/${repo}/issues/${pr}/comments?per_page=100`,
  });

  return comments.find((comment) => typeof comment.body === 'string' && comment.body.includes(MARKER));
}

function parseArgs(argv) {
  const options = {
    githubRepo: process.env.GITHUB_REPOSITORY || '',
    pr: process.env.PR_NUMBER || '',
    bodyFile: 'report.md',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--github-repo':
        options.githubRepo = takeValue(argv, ++index, arg);
        break;
      case '--pr':
        options.pr = takeValue(argv, ++index, arg);
        break;
      case '--body-file':
        options.bodyFile = takeValue(argv, ++index, arg);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.help && (!options.githubRepo || !options.pr)) {
    throw new Error('--github-repo and --pr are required unless GITHUB_REPOSITORY and PR_NUMBER are set.');
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
  return `PR Lie Detector Comment Updater

Usage:
  pr-lie-detector-comment --github-repo owner/repo --pr 123 --body-file report.md

Environment:
  GITHUB_TOKEN or GH_TOKEN is required.

This finds an existing PR comment containing ${MARKER} and updates it.
If none exists, it creates a new comment.
`;
}
