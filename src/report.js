const RISK_LABEL = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export function buildReport({ title, body, gitFacts, ruleReport, aiReport, githubComment }) {
  const markdown = renderMarkdown({ title, body, gitFacts, ruleReport, aiReport, githubComment });
  const json = {
    title,
    body,
    git: {
      repo: gitFacts.repo,
      range: gitFacts.range,
      requestedRange: gitFacts.requestedRange,
      warnings: gitFacts.warnings,
      changedFiles: gitFacts.changedFiles,
      stats: gitFacts.stats,
      commits: gitFacts.commits,
      diffTruncated: gitFacts.diffTruncated,
    },
    ruleReport,
    aiReport,
    markdown,
  };

  return { markdown, json };
}

function renderMarkdown({ title, gitFacts, ruleReport, aiReport, githubComment }) {
  const lines = [];

  if (githubComment) {
    lines.push('<!-- pr-lie-detector:report -->');
  }

  appendBanner(lines, ruleReport);

  lines.push(`## PR Lie Detector - Truth Score: ${ruleReport.truthScore}/100`);
  lines.push('');
  lines.push(`**Calculation:** ${formatScoreCalculation(ruleReport)}`);
  lines.push(`**Review Risk:** ${RISK_LABEL[ruleReport.riskLevel] || ruleReport.riskLevel} | **AI:** ${formatAiStatus(aiReport)}`);
  lines.push('');
  appendRiskAlert(lines, { ruleReport, aiReport });
  lines.push('');

  if (gitFacts.warnings.length > 0) {
    lines.push('> Warning: ' + gitFacts.warnings.join(' '));
    lines.push('');
  }

  lines.push('### Score Breakdown');
  lines.push('');
  appendScoreBreakdown(lines, ruleReport);
  lines.push('');

  lines.push('### Top Evidence');
  lines.push('');
  appendTopEvidence(lines, ruleReport);
  lines.push('');

  lines.push('<details>');
  lines.push('<summary>Full analysis, suggested PR text, and git stats</summary>');
  lines.push('');

  lines.push('### Claim vs Reality');
  lines.push('');
  appendClaimReality(lines, { title, ruleReport, aiReport });
  lines.push('');

  lines.push('### Evidence Board');
  lines.push('');
  appendEvidenceBoard(lines, ruleReport);
  lines.push('');

  lines.push('### Scoring Rubric');
  lines.push('');
  appendScoringRubric(lines, ruleReport);
  lines.push('');

  lines.push('### Reviewer Questions');
  lines.push('');
  appendReviewerQuestions(lines, { ruleReport, aiReport });
  lines.push('');

  lines.push('### Make It Honest');
  lines.push('');
  appendHonestDescription(lines, { title, ruleReport, aiReport });
  lines.push('');

  lines.push('### Changed Files');
  lines.push('');
  lines.push('```text');
  lines.push(`Range: ${gitFacts.range}`);
  lines.push('');
  lines.push(gitFacts.stats || '(no git stat output)');
  lines.push('');
  for (const file of gitFacts.changedFiles) {
    lines.push(`${file.status.padEnd(4)} ${file.previousPath ? `${file.previousPath} -> ` : ''}${file.path}`);
  }
  lines.push('```');
  lines.push('');
  lines.push('</details>');

  return lines.join('\n');
}

function appendRiskAlert(lines, { ruleReport, aiReport }) {
  const verdict = aiReport?.enabled && aiReport.summary ? aiReport.summary : ruleReport.ruleVerdict;
  const hasTruthDeductions = (ruleReport.scoreBreakdown?.deductions.length || 0) > 0;

  if (!hasTruthDeductions) {
    lines.push('> [!TIP]');
    lines.push(`> ${compactSentence(verdict, 240)}`);
    lines.push(`> Truthful description. Review risk remains ${RISK_LABEL[ruleReport.riskLevel] || ruleReport.riskLevel}.`);
    return;
  }

  if (ruleReport.riskLevel === 'high') {
    lines.push('> [!CAUTION]');
    lines.push(`> ${compactSentence(verdict, 240)}`);
    lines.push('> Treat this PR description as incomplete before requesting review.');
    return;
  }

  if (ruleReport.riskLevel === 'medium') {
    lines.push('> [!WARNING]');
    lines.push(`> ${compactSentence(verdict, 240)}`);
    return;
  }

  lines.push('> [!NOTE]');
  lines.push(`> ${compactSentence(verdict, 240)}`);
}

function formatScoreCalculation(ruleReport) {
  const breakdown = ruleReport.scoreBreakdown;

  if (!breakdown) {
    return 'No scoring breakdown available.';
  }

  return `${breakdown.baseScore} - ${breakdown.totalDeducted} fixed truth deductions`;
}

function formatAiStatus(aiReport) {
  if (aiReport?.enabled) {
    const provider = aiReport.provider || 'AI';
    const model = aiReport.model ? `/${aiReport.model}` : '';
    return `enabled (${provider}${model})`;
  }

  if (aiReport?.reason) {
    return `rule-based fallback (${compactReason(aiReport.reason)})`;
  }

  return 'rule-based fallback';
}

function appendScoreBreakdown(lines, ruleReport) {
  const breakdown = ruleReport.scoreBreakdown;

  if (!breakdown || breakdown.deductions.length === 0) {
    lines.push('- Starts at 100. No truth deductions were triggered.');
    lines.push('- AI does not affect the score.');
    return;
  }

  lines.push(`- Starts at ${breakdown.baseScore}. AI does not affect the score.`);
  lines.push('');
  lines.push('| Points | Truth deduction triggered |');
  lines.push('| ---: | --- |');

  for (const deduction of breakdown.deductions) {
    lines.push(`| -${deduction.points} | ${escapeTable(deduction.rubricLabel || deduction.label)} |`);
  }
}

function appendScoringRubric(lines, ruleReport) {
  const breakdown = ruleReport.scoreBreakdown;

  if (!breakdown) {
    lines.push('- Scoring breakdown was not generated.');
    return;
  }

  lines.push(`All deductions are fixed ${breakdown.rubric.unit}-point units. AI does not affect the score.`);
  lines.push('');
  lines.push('**Claim mismatch rules**');
  lines.push('');
  appendRubricRuleTable(lines, breakdown.rubric.claimMismatchRules);
  lines.push('');
  lines.push('**Missing disclosure rules**');
  lines.push('');
  appendRubricRuleTable(lines, breakdown.rubric.missingDisclosureRules);
  lines.push('');

  lines.push('**Triggered deductions**');
  lines.push('');
  lines.push('| Points | Type | Severity | Rule |');
  lines.push('| ---: | --- | --- | --- |');

  for (const deduction of breakdown.deductions) {
    lines.push(
      `| -${deduction.points} | ${formatDeductionSource(deduction.source)} | ${deduction.severity} | ${escapeTable(deduction.rubricLabel || deduction.label)} |`,
    );
  }

  lines.push('');
  lines.push('**Risk thresholds**');
  lines.push('');

  for (const threshold of breakdown.rubric.riskThresholds) {
    lines.push(`- ${threshold}`);
  }
}

function appendRubricRuleTable(lines, rules) {
  lines.push('| Points | Rule |');
  lines.push('| ---: | --- |');

  for (const rule of Object.values(rules)) {
    lines.push(`| -${rule.points} | ${escapeTable(rule.label)} |`);
  }
}

function formatDeductionSource(source) {
  if (source === 'claim_mismatch') {
    return 'Claim mismatch';
  }

  if (source === 'missing_disclosure') {
    return 'Missing disclosure';
  }

  return source;
}

function compactReason(reason) {
  return reason.replace(/\s+/g, ' ').slice(0, 220);
}

function compactSentence(value, limit) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();

  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function appendBanner(lines, ruleReport) {
  const bannerUrl = selectBannerUrl(ruleReport);

  if (!bannerUrl) {
    return;
  }

  lines.push(`![PR Lie Detector](${bannerUrl})`);
  lines.push('');
}

function selectBannerUrl(ruleReport) {
  if (ruleReport.truthScore === 100) {
    return normalizeMediaUrl(process.env.PR_LIE_DETECTOR_SUCCESS_BANNER_URL);
  }

  return normalizeMediaUrl(process.env.PR_LIE_DETECTOR_BANNER_URL);
}

function normalizeMediaUrl(value) {
  const url = String(value || '').trim();

  if (!/^https?:\/\/\S+$/i.test(url)) {
    return '';
  }

  return url;
}

function appendReviewerActions(lines, { title, ruleReport, aiReport }) {
  const actions = buildReviewerActions({ title, ruleReport, aiReport });

  if (actions.length === 0) {
    lines.push('- No immediate reviewer action needed.');
    return;
  }

  for (const action of actions.slice(0, 3)) {
    lines.push(`- ${action}`);
  }
}

function buildReviewerActions({ title, ruleReport, aiReport }) {
  const actions = [];
  const signalIds = new Set(ruleReport.signals.map((signal) => signal.id));
  const honestTitle = aiReport?.enabled && aiReport.honestTitle ? aiReport.honestTitle : suggestTitle(title, ruleReport);

  if (honestTitle && honestTitle !== title) {
    actions.push(`Ask author to rename the PR to: \`${inlineCode(honestTitle)}\`.`);
  }

  if (ruleReport.truthScore < 70) {
    actions.push('Pause review assignment until scope, tests, and rollout notes are clear.');
  }

  if (signalIds.has('migration_changed')) {
    actions.push('Ask for migration rollout and rollback notes.');
  }

  if (signalIds.has('api_surface_without_docs')) {
    actions.push('Ask for API docs or request specs for the changed endpoint.');
  }

  if (signalIds.has('service_without_tests') || signalIds.has('controller_without_tests')) {
    actions.push('Ask for focused tests for the changed service/controller behavior.');
  }

  if (actions.length < 3 && aiReport?.enabled) {
    for (const question of aiReport.reviewerQuestions) {
      actions.push(`Ask: ${compactSentence(question, 130)}`);

      if (actions.length >= 3) {
        break;
      }
    }
  }

  return Array.from(new Set(actions));
}

function appendTopEvidence(lines, ruleReport) {
  const signals = ruleReport.signals.slice(0, 3);

  if (signals.length === 0) {
    lines.push('- No high-signal evidence found.');
    return;
  }

  for (const signal of signals) {
    lines.push(`- **${signal.title}:** ${compactSentence(formatSignalEvidence(signal), 160)}`);
  }
}

function formatSignalEvidence(signal) {
  if (signal.evidence.length === 0) {
    return signal.detail;
  }

  return signal.evidence.slice(0, 3).join('; ');
}

function appendClaimReality(lines, { title, ruleReport, aiReport }) {
  if (aiReport?.enabled && aiReport.claims.length > 0) {
    for (const claim of aiReport.claims) {
      lines.push(`- **Claim:** ${claim.claim || title || '(not stated)'}`);
      lines.push(`  **Reality:** ${claim.reality || '(AI did not provide a reality statement)'}`);
      lines.push(`  **Status:** ${claim.status || 'incomplete'}`);

      if (claim.evidence.length > 0) {
        lines.push(`  **Evidence:** ${claim.evidence.slice(0, 4).join('; ')}`);
      }
    }

    return;
  }

  if (ruleReport.mismatches.length === 0) {
    lines.push('- No direct claim mismatch found by rule-based checks.');
    return;
  }

  for (const mismatch of ruleReport.mismatches) {
    lines.push(`- **Claim:** ${mismatch.claim}`);
    lines.push(`  **Reality:** ${mismatch.reality}`);
    lines.push(`  **Status:** ${mismatch.severity === 'high' ? 'suspicious' : 'incomplete'}`);

    if (mismatch.evidence.length > 0) {
      lines.push(`  **Evidence:** ${mismatch.evidence.slice(0, 4).join('; ')}`);
    }
  }
}

function appendEvidenceBoard(lines, ruleReport) {
  if (ruleReport.signals.length === 0) {
    lines.push('No high-signal evidence found.');
    return;
  }

  lines.push('| Severity | Signal | Evidence |');
  lines.push('| --- | --- | --- |');

  for (const signal of ruleReport.signals) {
    const evidence = signal.evidence.length > 0 ? signal.evidence.slice(0, 4).join('<br>') : signal.detail;
    lines.push(`| ${signal.severity} | ${escapeTable(signal.title)} | ${escapeTable(evidence)} |`);
  }
}

function appendReviewerQuestions(lines, { ruleReport, aiReport }) {
  const questions = [];

  if (aiReport?.enabled) {
    questions.push(...aiReport.reviewerQuestions);
  }

  if (questions.length === 0) {
    questions.push(...defaultQuestions(ruleReport));
  }

  if (questions.length === 0) {
    lines.push('- No specific reviewer questions generated.');
    return;
  }

  for (const question of questions.slice(0, 6)) {
    lines.push(`- ${question}`);
  }
}

function defaultQuestions(ruleReport) {
  const questions = [];
  const signalIds = new Set(ruleReport.signals.map((signal) => signal.id));

  if (signalIds.has('api_surface_without_docs')) {
    questions.push('Should API docs or request/controller tests be updated for this controller/route change?');
  }

  if (signalIds.has('service_without_tests')) {
    questions.push('What focused test proves the changed service behavior?');
  }

  if (signalIds.has('migration_changed')) {
    questions.push('Is the migration reversible and safe to deploy/rollback?');
  }

  if (signalIds.has('frozen_legacy_touched')) {
    questions.push('Why does this PR touch frozen Cb::Series legacy paths?');
  }

  if (signalIds.has('deleted_assertions')) {
    questions.push('Were the removed assertions replaced by equivalent coverage?');
  }

  return questions;
}

function appendHonestDescription(lines, { title, ruleReport, aiReport }) {
  if (aiReport?.enabled && (aiReport.honestTitle || aiReport.honestDescription)) {
    if (aiReport.honestTitle) {
      lines.push(`**Suggested title:** ${aiReport.honestTitle}`);
      lines.push('');
    }

    if (aiReport.honestDescription) {
      lines.push(aiReport.honestDescription);
      return;
    }
  }

  lines.push(`**Suggested title:** ${suggestTitle(title, ruleReport)}`);
  lines.push('');
  lines.push('```markdown');
  lines.push('## What changed');
  for (const bullet of summarizeChanges(ruleReport)) {
    lines.push(`- ${bullet}`);
  }
  lines.push('');
  lines.push('## Risk / reviewer focus');
  for (const signal of ruleReport.signals.slice(0, 5)) {
    lines.push(`- ${signal.title}: ${signal.detail}`);
  }
  lines.push('');
  lines.push('## Verification');
  lines.push('- Add focused commands or CI links here.');
  lines.push('```');
}

function suggestTitle(title, ruleReport) {
  if (ruleReport.mismatches.some((mismatch) => mismatch.id === 'refactor_claim_but_behavior_signals')) {
    const scope = title.replace(/\b(refactor|cleanup|clean up)\b\s*/i, '').trim();
    return scope ? `Clarify ${lowerFirst(scope)} behavior` : 'Clarify behavior changes and reviewer focus';
  }

  return title || 'Describe PR scope and reviewer focus';
}

function lowerFirst(value) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function inlineCode(value) {
  return String(value).replace(/`/g, "'");
}

function summarizeChanges(ruleReport) {
  const categories = ruleReport.categories;
  const bullets = [];

  if (categories.routes.length > 0 || categories.controllers.length > 0) {
    bullets.push('Updates controller/route behavior.');
  }

  if (categories.services.length > 0) {
    bullets.push('Updates service-layer logic.');
  }

  if (categories.models.length > 0) {
    bullets.push('Updates model-layer behavior.');
  }

  if (categories.migrations.length > 0) {
    bullets.push('Adds or changes database migration(s).');
  }

  if (categories.docs.length > 0) {
    bullets.push('Updates documentation.');
  }

  if (categories.tests.length > 0) {
    bullets.push('Updates test coverage.');
  }

  return bullets.length > 0 ? bullets : ['Summarize the actual changed scope.'];
}

function escapeTable(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}
