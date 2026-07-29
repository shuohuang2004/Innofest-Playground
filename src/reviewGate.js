import { readFileSync, writeFileSync } from 'node:fs';

import { githubJson } from './githubClient.js';

export function evaluateReviewGate({ report, threshold }) {
  const score = Number(report?.ruleReport?.truthScore);

  if (!Number.isFinite(score)) {
    throw new Error('Report JSON does not include ruleReport.truthScore.');
  }

  return {
    score,
    threshold,
    blocked: score < threshold,
    status: score < threshold ? 'blocked' : 'allowed',
  };
}

export function requestedReviewersFromEvent(event) {
  const reviewers = [];
  const teamReviewers = [];

  if (event?.requested_reviewer?.login) {
    reviewers.push(event.requested_reviewer.login);
  }

  if (event?.requested_team?.slug) {
    teamReviewers.push(event.requested_team.slug);
  }

  return { reviewers, teamReviewers };
}

export async function removeRequestedReviewers({ token, githubRepo, pr, reviewers, teamReviewers }) {
  if (reviewers.length === 0 && teamReviewers.length === 0) {
    return {
      removed: false,
      reason: 'No requested reviewer or team found in the event payload.',
      reviewers,
      teamReviewers,
    };
  }

  await githubJson({
    token,
    method: 'DELETE',
    path: `/repos/${githubRepo}/pulls/${pr}/requested_reviewers`,
    body: {
      reviewers,
      team_reviewers: teamReviewers,
    },
  });

  return {
    removed: true,
    reviewers,
    teamReviewers,
  };
}

export function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function appendGateSection({ reportMdPath, gate, removal }) {
  if (!reportMdPath) {
    return;
  }

  const existing = readFileSync(reportMdPath, 'utf8');
  const section = renderGateSection({ gate, removal });

  writeFileSync(reportMdPath, `${existing.trimEnd()}\n\n${section}\n`, 'utf8');
}

function renderGateSection({ gate, removal }) {
  const lines = [];
  lines.push('### Review Gate');
  lines.push('');
  lines.push(`**Status:** ${gate.blocked ? 'Blocked reviewer assignment' : 'Reviewer assignment allowed'}`);
  lines.push(`**Policy:** Truth Score must be at least ${gate.threshold} before requesting review.`);
  lines.push(`**Current score:** ${gate.score}/100`);

  if (gate.blocked) {
    lines.push('');
    lines.push('> [!CAUTION]');
    lines.push('> Truth Score is below the review threshold. The requested review should wait until the PR description is clearer.');
    lines.push('');

    const removedTargets = [
      ...(removal?.reviewers || []).map((reviewer) => `@${reviewer}`),
      ...(removal?.teamReviewers || []).map((team) => `team:${team}`),
    ];

    if (removal?.removed && removedTargets.length > 0) {
      lines.push(`**Action:** Removed requested reviewer(s): ${removedTargets.join(', ')}.`);
    } else {
      lines.push(`**Action:** Reviewer request should be removed before review starts.`);
    }
  }

  return lines.join('\n');
}
