import assert from 'node:assert/strict';
import test from 'node:test';

import { INLINE_MARKER, buildInlineComments, parseAddedLines } from '../src/inlineComments.js';

const checkoutPolicyDiff = [
  'diff --git a/demo-store/checkout-policy.yml b/demo-store/checkout-policy.yml',
  'index 1111111..2222222 100644',
  '--- a/demo-store/checkout-policy.yml',
  '+++ b/demo-store/checkout-policy.yml',
  '@@ -1,12 +1,12 @@',
  ' refunds:',
  '-  max_refund_days: 30',
  '-  auto_approve_under_usd: 25',
  '+  max_refund_days: 365',
  '+  auto_approve_under_usd: 500',
  ' ',
  ' discounts:',
  '-  max_discount_percent: 20',
  '-  stackable_coupons: false',
  '+  max_discount_percent: 95',
  '+  stackable_coupons: true',
].join('\n');

test('parses added diff lines with new-file line numbers', () => {
  assert.deepEqual(parseAddedLines(checkoutPolicyDiff).slice(0, 2), [
    {
      path: 'demo-store/checkout-policy.yml',
      line: 2,
      text: '  max_refund_days: 365',
    },
    {
      path: 'demo-store/checkout-policy.yml',
      line: 3,
      text: '  auto_approve_under_usd: 500',
    },
  ]);
});

test('builds focused inline comments for business policy signals', () => {
  withEnv('PR_LIE_DETECTOR_INLINE_ALERT_URL', 'https://example.com/inline-alert.jpg', () => {
    const comments = buildInlineComments({
      diff: checkoutPolicyDiff,
      limit: 2,
      ruleReport: {
        truthScore: 25,
        signals: [
          {
            id: 'business_rules_changed',
            severity: 'high',
            title: 'Business policy/config changed',
            detail: 'Reviewer should confirm customer impact.',
            evidence: ['demo-store/checkout-policy.yml'],
          },
        ],
        mismatches: [
          {
            severity: 'high',
            claim: 'PR appears to be framed around docs.',
          },
        ],
        scoreBreakdown: {
          deductions: [{ id: 'docs_claim_but_code_changed' }],
        },
      },
    });

    assert.equal(comments.length, 2);
    assert.equal(comments[0].path, 'demo-store/checkout-policy.yml');
    assert.equal(comments[0].side, 'RIGHT');
    assert.ok(comments[0].line > 0);
    assert.match(comments[0].body, new RegExp(INLINE_MARKER));
    assert.match(comments[0].body, /!\[PR Lie Detector warning\]\(https:\/\/example.com\/inline-alert\.jpg\)/);
    assert.match(comments[0].body, /customer-facing policy/);
    assert.match(comments[0].body, /PR appears to be framed around docs/);
  });
});

test('uses review-focus wording when the PR description is already truthful', () => {
  withEnv('PR_LIE_DETECTOR_INLINE_ALERT_URL', 'https://example.com/inline-alert.jpg', () => {
    const comments = buildInlineComments({
      diff: checkoutPolicyDiff,
      limit: 1,
      ruleReport: {
        truthScore: 100,
        signals: [
          {
            id: 'business_rules_changed',
            severity: 'high',
            title: 'Business policy/config changed',
            detail: 'Reviewer should confirm customer impact.',
            evidence: ['demo-store/checkout-policy.yml'],
          },
        ],
        mismatches: [],
        scoreBreakdown: {
          deductions: [],
        },
      },
    });

    assert.equal(comments.length, 1);
    assert.match(comments[0].body, /Review focus/);
    assert.doesNotMatch(comments[0].body, /Call out/);
    assert.doesNotMatch(comments[0].body, /!\[PR Lie Detector warning\]/);
  });
});

function withEnv(name, value, callback) {
  const previous = process.env[name];
  process.env[name] = value;

  try {
    callback();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}
