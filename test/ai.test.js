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

test('Gemini provider trims pasted secret wrappers before deciding key exists', async () => {
  const previousProvider = process.env.PR_LIE_DETECTOR_AI_PROVIDER;
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  const originalFetch = globalThis.fetch;

  process.env.PR_LIE_DETECTOR_AI_PROVIDER = 'gemini';
  process.env.GEMINI_API_KEY = ' GEMINI_API_KEY=\"fake-key-with-newline\" \n';

  let capturedKey = '';
  globalThis.fetch = async (_url, options) => {
    capturedKey = options.headers['x-goog-api-key'];
    return {
      ok: false,
      status: 400,
      text: async () => 'expected test failure',
    };
  };

  await runAiClaimChecker({
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

  assert.equal(capturedKey, 'fake-key-with-newline');

  globalThis.fetch = originalFetch;
  restoreEnv('PR_LIE_DETECTOR_AI_PROVIDER', previousProvider);
  restoreEnv('GEMINI_API_KEY', previousGeminiKey);
});

test('Gemini provider tries OpenAI-compatible endpoint after invalid Interactions key response', async () => {
  const previousProvider = process.env.PR_LIE_DETECTOR_AI_PROVIDER;
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  const originalFetch = globalThis.fetch;

  process.env.PR_LIE_DETECTOR_AI_PROVIDER = 'gemini';
  process.env.GEMINI_API_KEY = 'fake-key';

  const urls = [];
  globalThis.fetch = async (url, options) => {
    urls.push(String(url));

    if (urls.length === 1) {
      assert.equal(options.headers['x-goog-api-key'], 'fake-key');
      return {
        ok: false,
        status: 400,
        text: async () => 'API_KEY_INVALID: API key not valid',
      };
    }

    assert.equal(options.headers.Authorization, 'Bearer fake-key');
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: 'Description is incomplete for the changed behavior.',
                claims: [],
                missing_notes: [],
                reviewer_questions: [],
                honest_title: 'Document template update behavior changes',
                honest_description: 'Updates template behavior and database state.',
                confidence: 'high',
              }),
            },
          },
        ],
      }),
    };
  };

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
    model: 'gemini-3.6-flash',
  });

  assert.deepEqual(urls, [
    'https://generativelanguage.googleapis.com/v1beta/interactions',
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  ]);
  assert.equal(report.enabled, true);
  assert.equal(report.provider, 'gemini/openai-compatible');
  assert.equal(report.summary, 'Description is incomplete for the changed behavior.');

  globalThis.fetch = originalFetch;
  restoreEnv('PR_LIE_DETECTOR_AI_PROVIDER', previousProvider);
  restoreEnv('GEMINI_API_KEY', previousGeminiKey);
});

test('Gemini provider reports a concise reason when both endpoints reject the key', async () => {
  const previousProvider = process.env.PR_LIE_DETECTOR_AI_PROVIDER;
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  const originalFetch = globalThis.fetch;

  process.env.PR_LIE_DETECTOR_AI_PROVIDER = 'gemini';
  process.env.GEMINI_API_KEY = 'fake-key';

  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    text: async () => 'API_KEY_INVALID: API key not valid',
  });

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
    model: 'gemini-3.6-flash',
  });

  assert.equal(report.enabled, false);
  assert.equal(report.provider, 'gemini/openai-compatible');
  assert.equal(
    report.reason,
    'Gemini API key was rejected by both Interactions and OpenAI-compatible endpoints. Check the GEMINI_API_KEY secret value and Google API key restrictions.',
  );

  globalThis.fetch = originalFetch;
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
