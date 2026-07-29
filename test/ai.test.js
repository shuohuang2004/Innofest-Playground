import assert from 'node:assert/strict';
import test from 'node:test';

import { runAiClaimChecker } from '../src/ai.js';

test('Gemini provider falls back when GEMINI_API_KEY is missing', async () => {
  const previousProvider = process.env.PR_LIE_DETECTOR_AI_PROVIDER;
  const previousGeminiKey = process.env.GEMINI_API_KEY;

  process.env.PR_LIE_DETECTOR_AI_PROVIDER = 'gemini';
  delete process.env.GEMINI_API_KEY;

  const report = await runAiClaimChecker({
    title: 'Refactor template update service',
    body: '',
    gitFacts: {
      range: 'sample',
      changedFiles: [],
      stats: '',
      commits: '',
      diffExcerpt: '',
      diffTruncated: false,
    },
    ruleReport: {
      claims: [],
      mismatches: [],
      signals: [],
      truthScore: 100,
      riskLevel: 'low',
    },
    model: '',
  });

  assert.equal(report.enabled, false);
  assert.equal(report.provider, 'gemini');
  assert.match(report.reason, /GEMINI_API_KEY/);

  restoreEnv('PR_LIE_DETECTOR_AI_PROVIDER', previousProvider);
  restoreEnv('GEMINI_API_KEY', previousGeminiKey);
});

function restoreEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
