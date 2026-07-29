#!/usr/bin/env node

import { readFileSync } from 'node:fs';

import { githubJson } from '../src/githubClient.js';
import { runGit } from '../src/git.js';
import { INLINE_MARKER, buildInlineComments } from '../src/inlineComments.js';

main(process.argv.slice(2)).catch((error) => {
  console.error(`pr-lie-detector-inline-comments failed: ${error.message}`);
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
    throw new Error('Set GITHUB_TOKEN or GH_TOKEN before posting inline PR comments.');
  }

  const report = JSON.parse(readFileSync(options.reportJson, 'utf8'));
  const diff = await runGit(options.repo, ['diff', '--unified=40', '--find-renames', options.range]);
  const commitId = options.commitId || (await runGit(options.repo, ['rev-parse', 'HEAD'])).trim();
  const comments = buildInlineComments({
    diff,
    ruleReport: report.ruleReport,
    limit: options.limit,
  });

  await deleteExistingInlineComments({
    token,
    repo: options.githubRepo,
    pr: options.pr,
  });

  if (comments.length === 0) {
    console.log('No inline PR Lie Detector comments to post.');
    return;
  }

  for (const comment of comments) {
    await githubJson({
      token,
      method: 'POST',
      path: `/repos/${options.githubRepo}/pulls/${options.pr}/comments`,
      body: {
        body: comment.body,
        commit_id: commitId,
        path: comment.path,
        line: comment.line,
        side: comment.side,
      },
    });
  }

  console.log(`Posted ${comments.length} inline PR Lie Detector comment(s).`);
}

async function deleteExistingInlineComments({ token, repo, pr }) {
  const comments = await githubJson({
    token,
    method: 'GET',
    path: `/repos/${repo}/pulls/${pr}/comments?per_page=100`,
  });

  const existing = comments.filter((comment) => typeof comment.body === 'string' && comment.body.includes(INLINE_MARKER));

  for (const comment of existing) {
    await githubJson({
      token,
      method: 'DELETE',
      path: `/repos/${repo}/pulls/comments/${comment.id}`,
    });
  }

  if (existing.length > 0) {
    console.log(`Deleted ${existing.length} previous inline PR Lie Detector comment(s).`);
  }
}

function parseArgs(argv) {
  const options = {
    githubRepo: process.env.GITHUB_REPOSITORY || '',
    pr: process.env.PR_NUMBER || '',
    repo: process.cwd(),
    range: process.env.PR_LIE_DETECTOR_DIFF_RANGE || '',
    reportJson: 'report.json',
    commitId: '',
    limit: Number(process.env.PR_LIE_DETECTOR_INLINE_LIMIT || 3),
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
      case '--repo':
        options.repo = takeValue(argv, ++index, arg);
        break;
      case '--range':
        options.range = takeValue(argv, ++index, arg);
        break;
      case '--report-json':
        options.reportJson = takeValue(argv, ++index, arg);
        break;
      case '--commit-id':
        options.commitId = takeValue(argv, ++index, arg);
        break;
      case '--limit':
        options.limit = Number(takeValue(argv, ++index, arg));
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.help && (!options.githubRepo || !options.pr || !options.range)) {
    throw new Error('--github-repo, --pr, and --range are required unless provided by environment variables.');
  }

  if (!Number.isFinite(options.limit) || options.limit < 1 || options.limit > 10) {
    throw new Error('--limit must be a number between 1 and 10.');
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
  return `PR Lie Detector Inline Commenter

Usage:
  pr-lie-detector-inline-comments --github-repo owner/repo --pr 123 --repo . --range origin/main...HEAD --report-json report.json

Environment:
  GITHUB_TOKEN or GH_TOKEN is required.

This deletes previous ${INLINE_MARKER} review comments, then posts up to --limit inline comments on high-signal changed lines.
`;
}
