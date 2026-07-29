const INLINE_MARKER = '<!-- pr-lie-detector:inline -->';

const SIGNAL_PRIORITY = {
  business_rules_changed: 100,
  migration_changed: 90,
  frozen_legacy_touched: 80,
  deleted_assertions: 70,
  dependencies_changed: 60,
  api_surface_without_docs: 50,
  behavior_signals: 40,
  service_without_tests: 30,
  controller_without_tests: 30,
  ci_changed: 20,
};

const RISKY_LINE_PATTERNS = [
  /\b(max_refund_days|auto_approve|max_discount|stackable_coupons|manager_approval|fraud_review)\b/i,
  /\b(refund|discount|coupon|approval|fraud|pricing|billing|payment)\b/i,
  /\b(add_column|remove_column|create_table|drop_table|change_column)\b/i,
  /\b(if|unless|return|render|raise|authorize|authenticate|update!?|destroy!?|validates?)\b/i,
];

export { INLINE_MARKER };

export function buildInlineComments({ diff, ruleReport, limit = 3 }) {
  const addedLines = parseAddedLines(diff);
  const signals = [...(ruleReport?.signals || [])].sort((a, b) => signalPriority(b) - signalPriority(a));
  const candidates = [];

  for (const signal of signals) {
    for (const path of signal.evidence || []) {
      const lines = bestLinesForPath({
        addedLines,
        path: extractEvidencePath(path),
        signal,
      });

      for (const line of lines) {
        candidates.push({
          path: line.path,
          line: line.line,
          side: 'RIGHT',
          body: inlineBody({ signal, line, ruleReport }),
          score: signalPriority(signal) + riskyLineScore(line.text),
        });
      }
    }
  }

  return uniqueComments(candidates)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line)
    .slice(0, limit)
    .map(({ score, ...comment }) => comment);
}

export function parseAddedLines(diff) {
  const addedLines = [];
  let currentPath = '';
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const rawLine of String(diff || '').split(/\r?\n/)) {
    if (rawLine.startsWith('+++ b/')) {
      currentPath = rawLine.slice('+++ b/'.length);
      continue;
    }

    if (rawLine.startsWith('@@')) {
      const match = rawLine.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);

      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
        inHunk = true;
      }

      continue;
    }

    if (!inHunk || !currentPath) {
      continue;
    }

    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      addedLines.push({
        path: currentPath,
        line: newLine,
        text: rawLine.slice(1),
      });
      newLine += 1;
      continue;
    }

    if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
      oldLine += 1;
      continue;
    }

    oldLine += 1;
    newLine += 1;
  }

  return addedLines;
}

function bestLinesForPath({ addedLines, path, signal }) {
  if (!path) {
    return [];
  }

  return addedLines
    .filter((line) => line.path === path)
    .map((line) => ({
      ...line,
      score: riskyLineScore(line.text),
    }))
    .sort((a, b) => b.score - a.score || a.line - b.line)
    .slice(0, signal.id === 'business_rules_changed' ? 3 : 1);
}

function inlineBody({ signal, line, ruleReport }) {
  const claimHint = mainClaimHint(ruleReport);
  const lineText = line.text.trim();
  const compactLine = lineText.length > 90 ? `${lineText.slice(0, 87)}...` : lineText;
  const hasTruthDeductions = (ruleReport?.scoreBreakdown?.deductions.length || 0) > 0;

  if (signal.id === 'business_rules_changed') {
    if (!hasTruthDeductions) {
      return [
        INLINE_MARKER,
        `**PR Lie Detector:** Review focus: this line changes customer-facing policy: \`${escapeInlineCode(compactLine)}\`.`,
        'The PR description disclosed the policy change; verify customer impact, abuse risk, and rollout before approving.',
      ].join('\n\n');
    }

    return [
      INLINE_MARKER,
      inlineAlertImage(ruleReport),
      `**PR Lie Detector:** This line changes customer-facing policy: \`${escapeInlineCode(compactLine)}\`.`,
      claimHint,
      'Call out the refund, discount, approval, or rollout impact in the PR description.',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  if (signal.id === 'migration_changed') {
    if (!hasTruthDeductions) {
      return [
        INLINE_MARKER,
        '**PR Lie Detector:** Review focus: this line is part of a disclosed database/schema change.',
        'Verify rollout and rollback risk before approving.',
      ].join('\n\n');
    }

    return [
      INLINE_MARKER,
      inlineAlertImage(ruleReport),
      '**PR Lie Detector:** This line is part of a database/schema change.',
      claimHint,
      'Mention rollout and rollback risk before requesting review.',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  return [
    INLINE_MARKER,
    inlineAlertImage(ruleReport),
    `**PR Lie Detector:** This changed line contributes to **${signal.title}**.`,
    claimHint,
    signal.detail,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function mainClaimHint(ruleReport) {
  const mismatch = (ruleReport?.mismatches || []).find((item) => item.severity === 'high') || ruleReport?.mismatches?.[0];

  if (!mismatch) {
    return '';
  }

  return `PR claim to verify: ${mismatch.claim}`;
}

function inlineAlertImage(ruleReport) {
  if ((ruleReport?.truthScore ?? 100) >= 100) {
    return '';
  }

  const url = normalizeMediaUrl(process.env.PR_LIE_DETECTOR_INLINE_ALERT_URL);

  return url ? `![PR Lie Detector warning](${url})` : '';
}

function normalizeMediaUrl(value) {
  const url = String(value || '').trim();

  if (!/^https?:\/\/\S+$/i.test(url)) {
    return '';
  }

  return url;
}

function signalPriority(signal) {
  const severityBonus = signal.severity === 'high' ? 20 : signal.severity === 'medium' ? 10 : 0;
  return (SIGNAL_PRIORITY[signal.id] || 0) + severityBonus;
}

function riskyLineScore(text) {
  return RISKY_LINE_PATTERNS.reduce((score, pattern, index) => {
    if (!pattern.test(text)) {
      return score;
    }

    return score + 20 - index * 3;
  }, 0);
}

function uniqueComments(comments) {
  const seen = new Set();
  const unique = [];

  for (const comment of comments) {
    const key = `${comment.path}:${comment.line}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(comment);
  }

  return unique;
}

function extractEvidencePath(evidence) {
  return String(evidence || '').split(': ')[0].trim();
}

function escapeInlineCode(value) {
  return String(value).replace(/`/g, "'");
}
