export async function runAiClaimChecker({ title, body, gitFacts, ruleReport, model }) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      enabled: false,
      reason: 'OPENAI_API_KEY is not set. Rendered rule-based report only.',
    };
  }

  const payload = buildAiPayload({ title, body, gitFacts, ruleReport });
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
              text: [
                'Analyze this PR and return JSON with this shape:',
                JSON.stringify(aiSchemaExample(), null, 2),
                '',
                'PR facts:',
                JSON.stringify(payload, null, 2),
              ].join('\n'),
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
    model,
    ...normalizeAiReport(parsed),
  };
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
    confidence: asString(report.confidence || 'medium'),
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}
