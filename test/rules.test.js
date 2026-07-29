import assert from 'node:assert/strict';
import test from 'node:test';

import { scanRules } from '../src/rules.js';
import { buildReport } from '../src/report.js';

test('flags refactor claim when behavior and controller files changed', () => {
  const gitFacts = {
    changedFiles: [
      { status: 'M', path: 'app/services/template_service/update_template.rb' },
      { status: 'M', path: 'app/controllers/cms_api/templates_controller.rb' },
    ],
    diff: [
      'diff --git a/app/services/template_service/update_template.rb b/app/services/template_service/update_template.rb',
      '+    if template.hidden?',
      '+      return Failure.new(:hidden_template)',
      'diff --git a/app/controllers/cms_api/templates_controller.rb b/app/controllers/cms_api/templates_controller.rb',
      '+    render json: result.error, status: :unprocessable_entity',
    ].join('\n'),
  };

  const report = scanRules({
    title: 'Refactor template update service',
    body: '',
    gitFacts,
  });

  assert.equal(report.mismatches[0].id, 'refactor_claim_but_behavior_signals');
  assert.equal(report.riskLevel, 'high');
  assert.equal(report.truthScore, 55);
  assert.equal(report.scoreBreakdown.baseScore, 100);
  assert.equal(report.scoreBreakdown.totalDeducted, 45);
  assert.deepEqual(
    report.scoreBreakdown.deductions.map((deduction) => [deduction.id, deduction.points]),
    [
      ['refactor_claim_but_behavior_signals', 25],
      ['api_surface_without_docs', 5],
      ['service_without_tests', 5],
      ['controller_without_tests', 5],
      ['behavior_signals', 5],
    ],
  );
  assert.ok(report.scoreBreakdown.deductions.every((deduction) => deduction.points % 5 === 0));
});

test('flags frozen legacy paths', () => {
  const gitFacts = {
    changedFiles: [{ status: 'M', path: 'app/lib/cb/series/feed.rb' }],
    diff: 'diff --git a/app/lib/cb/series/feed.rb b/app/lib/cb/series/feed.rb\n+    return true',
  };

  const report = scanRules({
    title: 'Small cleanup',
    body: '',
    gitFacts,
  });

  assert.ok(report.signals.some((signal) => signal.id === 'frozen_legacy_touched'));
  assert.equal(report.riskLevel, 'high');
});

test('gives full truth score when a risky PR fully discloses the risk', () => {
  const gitFacts = {
    changedFiles: [
      { status: 'A', path: 'app/services/template_service/update_template.rb' },
      { status: 'A', path: 'app/controllers/cms_api/templates_controller.rb' },
      { status: 'A', path: 'config/routes.rb' },
      { status: 'A', path: 'db/migrate/20260729000000_add_template_review_state.rb' },
    ],
    diff: [
      'diff --git a/app/services/template_service/update_template.rb b/app/services/template_service/update_template.rb',
      '+    if template.hidden?',
      '+      return Failure.new(:hidden_template)',
      'diff --git a/app/controllers/cms_api/templates_controller.rb b/app/controllers/cms_api/templates_controller.rb',
      '+    render json: result.error, status: :unprocessable_entity',
    ].join('\n'),
  };

  const report = scanRules({
    title: 'Add template update API and review state',
    body: [
      '## What changed',
      '- Adds `CmsApi::TemplatesController#update` and routes for template updates.',
      '- Adds `TemplateService::UpdateTemplate` to handle update behavior, including hidden-template rejection.',
      '- Adds `review_state` to `templates` with default `draft`.',
      '',
      '## Risk / reviewer focus',
      '- Database migration changes production schema; verify rollout and rollback.',
      '- API/controller surface changes response shape and error handling.',
      '- Service/controller tests are not included and should be added before production merge.',
      '- Request specs are not included and should be added before production merge.',
    ].join('\n'),
    gitFacts,
  });

  assert.equal(report.truthScore, 100);
  assert.equal(report.riskLevel, 'high');
  assert.equal(report.scoreBreakdown.totalDeducted, 0);
  assert.deepEqual(report.scoreBreakdown.deductions, []);
  assert.ok(report.signals.every((signal) => signal.disclosed));
});

test('renders a GitHub-comment-style report without AI', () => {
  const gitFacts = {
    repo: '/repo',
    range: 'origin/dev...HEAD',
    requestedRange: 'origin/dev...HEAD',
    warnings: [],
    changedFiles: [{ status: 'M', path: 'app/services/template_service/update_template.rb' }],
    stats: ' app/services/template_service/update_template.rb | 4 +++-',
    commits: '',
    diffTruncated: false,
  };
  const ruleReport = scanRules({
    title: 'Refactor template update service',
    body: '',
    gitFacts: {
      ...gitFacts,
      diff: 'diff --git a/app/services/template_service/update_template.rb b/app/services/template_service/update_template.rb\n+    if valid?',
    },
  });

  const report = buildReport({
    title: 'Refactor template update service',
    body: '',
    gitFacts,
    ruleReport,
    aiReport: { enabled: false },
    githubComment: true,
  });

  assert.match(report.markdown, /<!-- pr-lie-detector:report -->/);
  assert.match(report.markdown, /## PR Lie Detector - Truth Score: \d+\/100/);
  assert.doesNotMatch(report.markdown, /# Truth Score:/);
  assert.match(report.markdown, /AI does not affect the score/);
  assert.match(report.markdown, /\| Points \| Truth deduction triggered \|/);
  assert.match(report.markdown, /All deductions are fixed 5-point units/);
  assert.match(report.markdown, /Scoring Rubric/);
  assert.match(report.markdown, /Make It Honest/);
  assert.doesNotMatch(report.markdown, /Reviewer Action/);
});

test('renders success banner image when a perfect truth score media URL is configured', () => {
  const previousBannerUrl = process.env.PR_LIE_DETECTOR_BANNER_URL;
  const previousSuccessBannerUrl = process.env.PR_LIE_DETECTOR_SUCCESS_BANNER_URL;
  process.env.PR_LIE_DETECTOR_BANNER_URL = 'https://example.com/pr-lie-detector.gif';
  process.env.PR_LIE_DETECTOR_SUCCESS_BANNER_URL = 'https://example.com/truth-score-100.jpg';

  const gitFacts = {
    repo: '/repo',
    range: 'origin/dev...HEAD',
    requestedRange: 'origin/dev...HEAD',
    warnings: [],
    changedFiles: [],
    stats: '',
    commits: '',
    diffTruncated: false,
  };
  const ruleReport = scanRules({
    title: 'Update docs',
    body: '',
    gitFacts: {
      ...gitFacts,
      diff: '',
    },
  });

  const report = buildReport({
    title: 'Update docs',
    body: '',
    gitFacts,
    ruleReport,
    aiReport: { enabled: false },
    githubComment: true,
  });

  assert.match(report.markdown, /!\[PR Lie Detector\]\(https:\/\/example.com\/truth-score-100.jpg\)/);
  assert.doesNotMatch(report.markdown, /pr-lie-detector.gif/);

  if (previousBannerUrl === undefined) {
    delete process.env.PR_LIE_DETECTOR_BANNER_URL;
  } else {
    process.env.PR_LIE_DETECTOR_BANNER_URL = previousBannerUrl;
  }

  if (previousSuccessBannerUrl === undefined) {
    delete process.env.PR_LIE_DETECTOR_SUCCESS_BANNER_URL;
  } else {
    process.env.PR_LIE_DETECTOR_SUCCESS_BANNER_URL = previousSuccessBannerUrl;
  }
});
