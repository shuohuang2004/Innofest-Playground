export async function runAiClaimChecker({ title, body, gitFacts, ruleReport, model }) {
  const provider = resolveProvider();

  if (!provider.enabled) {
    return provider;
  }

  const payload = buildAiPayload({ title, body, gitFacts, ruleReport });
  const prompt = buildPrompt(payload);

  if (provider.name === 'gemini') {
    return runGeminiClaimChecker({
      apiKey: provider.apiKey,
      model: model || process.env.PR_LIE_DETECTOR_GEMINI_MODEL || 'gemini-3.6-flash',
      prompt,
    });
  }

  if (provider.name === 'openrouter') {
    return runOpenRouterClaimChecker({
      apiKey: provider.apiKey,
      model: model || process.env.PR_LIE_DETECTOR_OPENROUTER_MODEL || 'google/gemini-2.5-flash',
      prompt,
    });
  }

  return runOpenAiClaimChecker({
    apiKey: provider.apiKey,
    model: model || process.env.PR_LIE_DETECTOR_OPENAI_MODEL || 'gpt-4.1-mini',
    prompt,
  });
}

async function runOpenAiClaimChecker({ apiKey, model, prompt }) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: [
                'You are PR Lie Detector, a code review assistant.',
                'Your job is to compare what a PR claims with what the diff facts show.',
                'Never accuse the author of lying. Use wording like "description may be incomplete", "mismatch", or "claim needs evidence".',
                'Ground every concern in provided facts. Do not invent files, line numbers, CI results, or tests.',
                'Return only valid JSON. No Markdown fences.',
              ].join('\n'),
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: prompt,
            },
          ],
        },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    return {
      enabled: false,
      reason: `OpenAI request failed (${response.status}): ${bodyText.slice(0, 400)}`,
    };
  }

  const data = await response.json();
  const outputText = extractOutputText(data);
  const parsed = parseJsonObject(outputText);

  if (!parsed) {
    return {
      enabled: false,
      reason: 'OpenAI returned a non-JSON response. Rendered rule-based report only.',
      raw: outputText,
    };
  }

  return {
    enabled: true,
    provider: 'openai',
    model,
    ...normalizeAiReport(parsed),
  };
}

async function runGeminiClaimChecker({ apiKey, model, prompt }) {
  const interactionsResult = await runGeminiInteractions({ apiKey, model, prompt });

  if (interactionsResult.enabled || !isInvalidGeminiApiKey(interactionsResult.reason)) {
    return interactionsResult;
  }

  const compatibilityResult = await runGeminiOpenAiCompatibility({ apiKey, model, prompt });

  if (compatibilityResult.enabled) {
    return compatibilityResult;
  }

  if (isInvalidGeminiApiKey(compatibilityResult.reason)) {
    return {
      ...compatibilityResult,
      reason: 'Gemini API key was rejected by both Interactions and OpenAI-compatible endpoints. Check the GEMINI_API_KEY secret value and Google API key restrictions.',
    };
  }

  return {
    ...compatibilityResult,
    reason: `${interactionsResult.reason} | OpenAI-compatible fallback: ${compatibilityResult.reason}`,
  };
}

async function runGeminiInteractions({ apiKey, model, prompt }) {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      model,
      input: [
        'You are PR Lie Detector, a code review assistant.',
        'Your job is to compare what a PR claims with what the diff facts show.',
        'Never accuse the author of lying. Use wording like "description may be incomplete", "mismatch", or "claim needs evidence".',
        'Ground every concern in provided facts. Do not invent files, line numbers, CI results, or tests.',
        'Return only valid JSON. No Markdown fences.',
        '',
        prompt,
      ].join('\n'),
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    return {
      enabled: false,
      provider: 'gemini/interactions',
      reason: `Gemini Interactions request failed (${response.status}): ${bodyText.slice(0, 400)}`,
    };
  }

  const data = await response.json();
  const outputText = extractGeminiOutputText(data);
  const parsed = parseJsonObject(outputText);

  if (!parsed) {
    return {
      enabled: false,
      provider: 'gemini/interactions',
      reason: 'Gemini Interactions returned a non-JSON response. Rendered rule-based report only.',
      raw: outputText,
    };
  }

  return {
    enabled: true,
    provider: 'gemini/interactions',
    model,
    ...normalizeAiReport(parsed),
  };
}

async function runGeminiOpenAiCompatibility({ apiKey, model, prompt }) {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: [
            'You are PR Lie Detector, a code review assistant.',
            'Your job is to compare what a PR claims with what the diff facts show.',
            'Never accuse the author of lying. Use wording like "description may be incomplete", "mismatch", or "claim needs evidence".',
            'Ground every concern in provided facts. Do not invent files, line numbers, CI results, or tests.',
            'Return only valid JSON. No Markdown fences.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    return {
      enabled: false,
      provider: 'gemini/openai-compatible',
      reason: `Gemini OpenAI-compatible request failed (${response.status}): ${bodyText.slice(0, 400)}`,
    };
  }

  const data = await response.json();
  const outputText = extractOpenAiChatOutputText(data);
  const parsed = parseJsonObject(outputText);

  if (!parsed) {
    return {
      enabled: false,
      provider: 'gemini/openai-compatible',
      reason: 'Gemini OpenAI-compatible endpoint returned a non-JSON response. Rendered rule-based report only.',
      raw: outputText,
    };
  }

  return {
    enabled: true,
    provider: 'gemini/openai-compatible',
    model,
    ...normalizeAiReport(parsed),
  };
}

async function runOpenRouterClaimChecker({ apiKey, model, prompt }) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-OpenRouter-Title': process.env.PR_LIE_DETECTOR_OPENROUTER_TITLE || 'PR Lie Detector',
  };
  const referer = process.env.PR_LIE_DETECTOR_OPENROUTER_REFERER || process.env.GITHUB_SERVER_URL;

  if (referer) {
    headers['HTTP-Referer'] = referer;
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: [
            'You are PR Lie Detector, a code review assistant.',
            'Your job is to compare what a PR claims with what the diff facts show.',
            'Never accuse the author of lying. Use wording like "description may be incomplete", "mismatch", or "claim needs evidence".',
            'Ground every concern in provided facts. Do not invent files, line numbers, CI results, or tests.',
            'Return only valid JSON. No Markdown fences.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    return {
      enabled: false,
      provider: 'openrouter',
      reason: `OpenRouter request failed (${response.status}): ${bodyText.slice(0, 400)}`,
    };
  }

  const data = await response.json();
  const outputText = extractOpenAiChatOutputText(data);
  const parsed = parseJsonObject(outputText);

  if (!parsed) {
    return {
      enabled: false,
      provider: 'openrouter',
      reason: 'OpenRouter returned a non-JSON response. Rendered rule-based report only.',
      raw: outputText,
    };
  }

  return {
    enabled: true,
    provider: 'openrouter',
    model,
    ...normalizeAiReport(parsed),
  };
}

function isInvalidGeminiApiKey(reason = '') {
  return /API_KEY_INVALID|API key not valid|invalid api key|pass a valid API key/i.test(reason);
}

function resolveProvider() {
  const requested = (process.env.PR_LIE_DETECTOR_AI_PROVIDER || 'auto').toLowerCase();
  const openRouterKey = normalizeSecretKey(process.env.OPENROUTER_API_KEY);
  const openAiKey = normalizeSecretKey(process.env.OPENAI_API_KEY);
  const geminiKey = normalizeSecretKey(
    process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY,
  );

  if (requested === 'openrouter') {
    return openRouterKey
      ? { enabled: true, name: 'openrouter', apiKey: openRouterKey }
      : {
          enabled: false,
          provider: 'openrouter',
          reason: 'OPENROUTER_API_KEY is not set. Rendered rule-based report only.',
        };
  }

  if (requested === 'gemini') {
    return geminiKey
      ? { enabled: true, name: 'gemini', apiKey: geminiKey }
      : { enabled: false, provider: 'gemini', reason: 'GEMINI_API_KEY is not set. Rendered rule-based report only.' };
  }

  if (requested === 'openai') {
    return openAiKey
      ? { enabled: true, name: 'openai', apiKey: openAiKey }
      : { enabled: false, provider: 'openai', reason: 'OPENAI_API_KEY is not set. Rendered rule-based report only.' };
  }

  if (openRouterKey) {
    return { enabled: true, name: 'openrouter', apiKey: openRouterKey };
  }

  if (geminiKey) {
    return { enabled: true, name: 'gemini', apiKey: geminiKey };
  }

  if (openAiKey) {
    return { enabled: true, name: 'openai', apiKey: openAiKey };
  }

  return {
    enabled: false,
    provider: 'none',
    reason:
      'No AI key found. Set OPENROUTER_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY to enable AI; rendered rule-based report only.',
  };
}

function normalizeSecretKey(value) {
  if (!value) {
    return '';
  }

  let key = String(value).trim();

  if (/^[A-Z0-9_]+_API_KEY\s*=/.test(key)) {
    key = key.split('=', 2)[1].trim();
  }

  key = key.replace(/^['"]|['"]$/g, '');
  key = key.replace(/\s+/g, '');

  return key;
}

function buildPrompt(payload) {
  return [
    'Analyze this PR and return JSON with this shape:',
    JSON.stringify(aiSchemaExample(), null, 2),
    '',
    'Scoring instructions:',
    '- Do not invent score numbers. The script will calculate the score from fixed rubric IDs.',
    '- Use only rubric IDs shown in scoring_rubric.',
    '- claim_mismatches[].triggered means the PR text makes a claim that is contradicted by the diff facts.',
    '- signal_disclosures[].disclosed means the PR text adequately disclosed that detected diff signal.',
    '- If the PR says something like "docs change and introduces a new function", do not treat it as docs-only.',
    '- If a risky change is disclosed but not fully justified, mark it disclosed; reviewer questions can ask for more context.',
    '- Ground every decision in changed files, diff lines, or PR text from the input.',
    '',
    'PR facts:',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

function buildAiPayload({ title, body, gitFacts, ruleReport }) {
  return {
    title,
    body,
    range: gitFacts.range,
    changed_files: gitFacts.changedFiles,
    stats: gitFacts.stats,
    commits: gitFacts.commits,
    diff_excerpt: gitFacts.diffExcerpt,
    diff_truncated: gitFacts.diffTruncated,
    rule_claims: ruleReport.claims,
    rule_mismatches: ruleReport.mismatches,
    rule_signals: ruleReport.signals,
    rule_truth_score: ruleReport.truthScore,
    rule_risk_level: ruleReport.riskLevel,
    scoring_rubric: ruleReport.scoreBreakdown?.rubric,
  };
}

function aiSchemaExample() {
  return {
    summary: 'One sentence verdict for a GitHub PR comment.',
    claims: [
      {
        claim: 'What the PR title/body claims.',
        reality: 'What the facts show.',
        status: 'supported | incomplete | suspicious | unsupported',
        evidence: ['file or fact from the input'],
      },
    ],
    missing_notes: ['Risk or scope notes missing from the PR description.'],
    reviewer_questions: ['Focused question a reviewer should ask.'],
    honest_title: 'Suggested more accurate PR title.',
    honest_description: 'Suggested PR description in Markdown.',
    scoring_decisions: {
      claim_mismatches: [
        {
          id: 'docs_claim_but_code_changed',
          triggered: false,
          claim: 'Claim from PR title/body, if triggered.',
          reality: 'What the diff facts show, if triggered.',
          evidence: ['file or fact from the input'],
          reason: 'Why this fixed rubric item is or is not triggered.',
        },
      ],
      signal_disclosures: [
        {
          id: 'migration_changed',
          disclosed: false,
          evidence: ['file or fact from the input'],
          reason: 'Whether the PR text disclosed this detected signal.',
        },
      ],
    },
    confidence: 'low | medium | high',
  };
}

function extractOutputText(data) {
  if (typeof data.output_text === 'string') {
    return data.output_text;
  }

  const chunks = [];

  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === 'string') {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join('\n').trim();
}

function extractGeminiOutputText(data) {
  if (typeof data.output_text === 'string') {
    return data.output_text;
  }

  if (typeof data.outputText === 'string') {
    return data.outputText;
  }

  const chunks = [];

  for (const step of data.steps || []) {
    const contents = step.model_output?.content || step.modelOutput?.content || step.content || [];

    for (const item of contents) {
      if (typeof item.text === 'string') {
        chunks.push(item.text);
      } else if (typeof item.text?.text === 'string') {
        chunks.push(item.text.text);
      }
    }
  }

  for (const candidate of data.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (typeof part.text === 'string') {
        chunks.push(part.text);
      }
    }
  }

  return chunks.join('\n').trim();
}

function extractOpenAiChatOutputText(data) {
  return data.choices?.[0]?.message?.content || '';
}

function parseJsonObject(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);

    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normalizeAiReport(report) {
  return {
    summary: asString(report.summary),
    claims: asArray(report.claims).map((claim) => ({
      claim: asString(claim.claim),
      reality: asString(claim.reality),
      status: asString(claim.status || 'incomplete'),
      evidence: asArray(claim.evidence).map(asString).filter(Boolean),
    })),
    missingNotes: asArray(report.missing_notes || report.missingNotes).map(asString).filter(Boolean),
    reviewerQuestions: asArray(report.reviewer_questions || report.reviewerQuestions).map(asString).filter(Boolean),
    honestTitle: asString(report.honest_title || report.honestTitle),
    honestDescription: asString(report.honest_description || report.honestDescription),
    scoringDecisions: normalizeScoringDecisions(report.scoring_decisions || report.scoringDecisions),
    confidence: asString(report.confidence || 'medium'),
  };
}

function normalizeScoringDecisions(decisions) {
  if (!decisions || typeof decisions !== 'object') {
    return null;
  }

  return {
    claimMismatches: asArray(decisions?.claim_mismatches || decisions?.claimMismatches).map((decision) => ({
      id: asString(decision.id),
      triggered: decision.triggered === true,
      claim: asString(decision.claim),
      reality: asString(decision.reality),
      evidence: asArray(decision.evidence).map(asString).filter(Boolean),
      reason: asString(decision.reason),
    })),
    signalDisclosures: asArray(decisions?.signal_disclosures || decisions?.signalDisclosures).map((decision) => ({
      id: asString(decision.id),
      disclosed: decision.disclosed === true,
      evidence: asArray(decision.evidence).map(asString).filter(Boolean),
      reason: asString(decision.reason),
    })),
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}
