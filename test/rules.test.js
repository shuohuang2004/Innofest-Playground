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
  assert.ok(report.truthScore < 80);
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
  assert.match(report.markdown, /## PR Lie Detector/);
  assert.match(report.markdown, /Make It Honest/);
});

test('renders optional banner image when a media URL is configured', () => {
  const previousBannerUrl = process.env.PR_LIE_DETECTOR_BANNER_URL;
  process.env.PR_LIE_DETECTOR_BANNER_URL = 'https://example.com/pr-lie-detector.gif';

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

  assert.match(report.markdown, /!\[PR Lie Detector\]\(https:\/\/example.com\/pr-lie-detector.gif\)/);

  if (previousBannerUrl === undefined) {
    delete process.env.PR_LIE_DETECTOR_BANNER_URL;
  } else {
    process.env.PR_LIE_DETECTOR_BANNER_URL = previousBannerUrl;
  }
});
