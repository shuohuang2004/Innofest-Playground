import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateReviewGate, requestedReviewersFromEvent } from '../src/reviewGate.js';

test('blocks when score is below threshold', () => {
  const gate = evaluateReviewGate({
    report: { ruleReport: { truthScore: 69 } },
    threshold: 70,
  });

  assert.equal(gate.blocked, true);
  assert.equal(gate.status, 'blocked');
});

test('allows when score is equal to threshold', () => {
  const gate = evaluateReviewGate({
    report: { ruleReport: { truthScore: 70 } },
    threshold: 70,
  });

  assert.equal(gate.blocked, false);
  assert.equal(gate.status, 'allowed');
});

test('extracts requested user and team from pull_request event payload', () => {
  assert.deepEqual(
    requestedReviewersFromEvent({
      requested_reviewer: { login: 'octocat' },
    }),
    {
      reviewers: ['octocat'],
      teamReviewers: [],
    },
  );

  assert.deepEqual(
    requestedReviewersFromEvent({
      requested_team: { slug: 'backend' },
    }),
    {
      reviewers: [],
      teamReviewers: ['backend'],
    },
  );
});
