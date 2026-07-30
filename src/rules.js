const FROZEN_LEGACY_PATHS = [
  'app/decorators/cb/series/',
  'app/lib/cb/series/',
  'test/unit/cb/series/',
];

const CATEGORY_RULES = [
  ['controllers', /^app\/controllers\//],
  ['services', /^app\/services\//],
  ['models', /^app\/models\//],
  ['migrations', /^(db\/migrate\/|migrations\/)/],
  ['routes', /^config\/routes\.rb$/],
  ['tests', /(^test\/|^spec\/|_test\.rb$|_spec\.rb$|\.test\.[jt]sx?$|\.spec\.[jt]sx?$)/],
  [
    'businessRules',
    /^(demo-store\/.*(billing|checkout|coupon|discount|payment|policy|pricing|refund|risk|rules).*\.(json|ya?ml|toml)$|policies\/|rules\/|config\/(billing|checkout|discount|feature|features|payment|pricing|refund|risk|rules)[^/]*\.(json|ya?ml|toml)$)/i,
  ],
  ['docs', /(^docs\/|README|redocly\.ya?ml$|openapi|swagger)/i],
  ['dependencies', /^(Gemfile|Gemfile\.lock|package\.json|yarn\.lock|package-lock\.json)$/],
  ['ci', /^(\.circleci\/|\.github\/workflows\/|\.github\/actions\/)/],
];

const CLAIM_PATTERNS = [
  {
    id: 'refactor_only',
    label: 'Claims refactor/cleanup only',
    pattern: /\b(refactor|cleanup|clean\s*up|rename|extract|organize|tidy)\b/i,
  },
  {
    id: 'docs_only',
    label: 'Claims docs-only work',
    pattern: /\b(only|just|purely)\s+(docs?|documentation|readme)\b|\b(docs?|documentation|readme)[-\s]+only\b/i,
  },
  {
    id: 'test_only',
    label: 'Claims test-only work',
    pattern: /\b(only|just|purely)\s+(tests?|specs?|coverage)\b|\b(tests?|specs?|coverage)[-\s]+only\b/i,
  },
  {
    id: 'no_behavior_change',
    label: 'Claims no behavior change',
    pattern: /\b(no behavior change|no behavioural change|behavior unchanged|behaviour unchanged|non[- ]?functional)\b/i,
  },
  {
    id: 'small_change',
    label: 'Frames the PR as small/simple',
    pattern: /\b(small|minor|simple|tiny|quick)\b/i,
  },
];

const CODE_SCOPE_DISCLOSURE_PATTERN =
  /\b(adds?|added|introduces?|introduced|creates?|created|implements?|implemented|updates?|updated|changes?|changed|modifies?|modified)\b[\s\S]{0,90}\b(function|code|logic|api|endpoint|controller|service|migration|database|db|schema|authorization|auth|permission|access)\b|\b(function|code|logic|api|endpoint|controller|service|migration|database|db|schema|authorization|auth|permission|access)\b[\s\S]{0,90}\b(adds?|added|introduces?|introduced|creates?|created|implements?|implemented|updates?|updated|changes?|changed|modifies?|modified)\b/i;

const BEHAVIOR_LINE_PATTERN =
  /^\s*[+-]\s*(if|unless|elsif|else|case|when|return|render|redirect_to|raise|rescue|where|find_by|update!?|create!?|destroy!?|save!?|validates?|before_action|skip_before_action|authorize|authenticate|current_user|admin\?|policy|scope|enqueue|perform_later)\b/i;

const ASSERTION_LINE_PATTERN =
  /^\s*-\s*(assert|refute|expect|must_|wont_|should|it\s+['"`]|test\s+['"`])/i;

const SCORE_RUBRIC = {
  baseScore: 100,
  minimumScore: 0,
  unit: 5,
  claimMismatchRules: {
    refactor_claim_but_behavior_signals: {
      points: 25,
      label: 'Refactor/no-behavior claim contradicted by behavior, API, database, or business policy changes',
    },
    docs_claim_but_code_changed: {
      points: 25,
      label: 'Docs-only claim contradicted by application, database, or business policy changes',
    },
    test_claim_but_code_changed: {
      points: 15,
      label: 'Test-only claim contradicted by application, database, or business policy changes',
    },
    small_claim_but_high_risk: {
      points: 10,
      label: 'Small/minor framing while high-risk signals are present',
    },
  },
  missingDisclosureRules: {
    frozen_legacy_touched: {
      points: 20,
      label: 'Frozen legacy touch was not disclosed',
    },
    migration_changed: {
      points: 10,
      label: 'Database migration was not disclosed',
    },
    dependencies_changed: {
      points: 10,
      label: 'Dependency manifest or lockfile change was not disclosed',
    },
    deleted_assertions: {
      points: 10,
      label: 'Removed test assertions were not disclosed',
    },
    business_rules_changed: {
      points: 15,
      label: 'Business policy/config change was not disclosed',
    },
    api_surface_without_docs: {
      points: 5,
      label: 'Missing API docs/request specs were not disclosed',
    },
    service_without_tests: {
      points: 5,
      label: 'Missing service tests were not disclosed',
    },
    controller_without_tests: {
      points: 5,
      label: 'Missing controller tests were not disclosed',
    },
    behavior_signals: {
      points: 5,
      label: 'Behavior changes were not disclosed',
    },
    ci_changed: {
      points: 5,
      label: 'CI/CD configuration change was not disclosed',
    },
  },
};

const CLAIM_MISMATCH_SEVERITY = {
  refactor_claim_but_behavior_signals: 'high',
  docs_claim_but_code_changed: 'high',
  test_claim_but_code_changed: 'medium',
  small_claim_but_high_risk: 'medium',
};

export function scanRules({ title, body, gitFacts }) {
  const changedFiles = gitFacts.changedFiles;
  const paths = changedFiles.map((file) => file.path);
  const categories = categorizePaths(paths);
  const prText = `${title}\n\n${body}`;
  const claims = detectClaims(prText);
  const behaviorSignals = detectBehaviorSignals(gitFacts.diff);
  const deletedAssertions = detectDeletedAssertions(gitFacts.diff);
  const signals = [];

  if (categories.frozenLegacy.length > 0) {
    signals.push({
      id: 'frozen_legacy_touched',
      severity: 'high',
      title: 'Frozen legacy code touched',
      detail: 'This repo marks Cb::Series paths as read-only dependencies.',
      evidence: categories.frozenLegacy,
    });
  }

  if (categories.migrations.length > 0) {
    signals.push({
      id: 'migration_changed',
      severity: 'high',
      title: 'Database migration changed',
      detail: 'PR description should call out rollout and rollback risk.',
      evidence: categories.migrations,
    });
  }

  if ((categories.controllers.length > 0 || categories.routes.length > 0) && categories.docs.length === 0) {
    signals.push({
      id: 'api_surface_without_docs',
      severity: 'medium',
      title: 'API/controller surface changed without docs changes',
      detail: 'Reviewer should confirm whether API docs or request specs need updates.',
      evidence: [...categories.routes, ...categories.controllers].slice(0, 8),
    });
  }

  if (categories.services.length > 0 && categories.tests.length === 0) {
    signals.push({
      id: 'service_without_tests',
      severity: 'medium',
      title: 'Service code changed without tests',
      detail: 'Service changes often need focused unit/service tests or a verification note.',
      evidence: categories.services.slice(0, 8),
    });
  }

  if (categories.controllers.length > 0 && categories.tests.length === 0) {
    signals.push({
      id: 'controller_without_tests',
      severity: 'medium',
      title: 'Controller code changed without tests',
      detail: 'Controller changes can alter status codes, permissions, params, or response shape.',
      evidence: categories.controllers.slice(0, 8),
    });
  }

  if (categories.dependencies.length > 0) {
    signals.push({
      id: 'dependencies_changed',
      severity: 'medium',
      title: 'Dependencies changed',
      detail: 'Dependency changes should include compatibility and security notes.',
      evidence: categories.dependencies,
    });
  }

  if (categories.businessRules.length > 0) {
    signals.push({
      id: 'business_rules_changed',
      severity: 'high',
      title: 'Business policy/config changed',
      detail: 'Reviewer should confirm customer impact, approval limits, pricing, refunds, or rollout notes.',
      evidence: categories.businessRules.slice(0, 8),
    });
  }

  if (behaviorSignals.length > 0) {
    signals.push({
      id: 'behavior_signals',
      severity: 'medium',
      title: 'Diff contains behavior-change signals',
      detail: 'Conditional, return, query, validation, auth, or persistence lines changed.',
      evidence: behaviorSignals.slice(0, 8),
    });
  }

  if (deletedAssertions.length > 0) {
    signals.push({
      id: 'deleted_assertions',
      severity: 'medium',
      title: 'Test assertions were removed',
      detail: 'Removed assertions can weaken the PR alibi even when CI passes.',
      evidence: deletedAssertions.slice(0, 8),
    });
  }

  if (categories.ci.length > 0) {
    signals.push({
      id: 'ci_changed',
      severity: 'low',
      title: 'CI/CD configuration changed',
      detail: 'Reviewer should check pipeline behavior, required checks, and secrets assumptions.',
      evidence: categories.ci,
    });
  }

  const disclosedSignals = attachSignalDisclosures(signals, prText);
  const mismatches = detectRuleBasedMismatches({ claims, categories, behaviorSignals, signals });
  const scoreBreakdown = scoreTruth({ mismatches, signals: disclosedSignals, scoringMode: 'rule_based' });
  const truthScore = scoreBreakdown.score;
  const riskLevel = scoreToRisk(truthScore, disclosedSignals, mismatches);

  return {
    categories,
    claims,
    behaviorSignals,
    deletedAssertions,
    signals: disclosedSignals,
    mismatches,
    scoreBreakdown,
    truthScore,
    riskLevel,
    ruleVerdict: verdictFor({ truthScore, mismatches, signals: disclosedSignals, scoreBreakdown }),
  };
}

export function applyAiScoring(ruleReport, aiReport) {
  if (!aiReport?.enabled || !hasAiScoringDecisions(aiReport.scoringDecisions)) {
    return ruleReport;
  }

  const signals = applyAiSignalDisclosures(ruleReport.signals, aiReport.scoringDecisions.signalDisclosures);
  const mismatches = buildAiMismatches({
    baseMismatches: ruleReport.mismatches,
    claimDecisions: aiReport.scoringDecisions.claimMismatches,
  });
  const scoreBreakdown = scoreTruth({ mismatches, signals, scoringMode: 'ai_assisted' });
  const truthScore = scoreBreakdown.score;
  const riskLevel = scoreToRisk(truthScore, signals, mismatches);

  return {
    ...ruleReport,
    signals,
    mismatches,
    scoreBreakdown,
    truthScore,
    riskLevel,
    ruleVerdict: verdictFor({ truthScore, mismatches, signals, scoreBreakdown }),
    aiScoring: {
      applied: true,
      confidence: aiReport.confidence || 'medium',
    },
  };
}

function categorizePaths(paths) {
  const categories = Object.fromEntries(CATEGORY_RULES.map(([name]) => [name, []]));
  categories.other = [];
  categories.frozenLegacy = [];

  for (const path of paths) {
    let matched = false;

    for (const [name, pattern] of CATEGORY_RULES) {
      if (pattern.test(path)) {
        categories[name].push(path);
        matched = true;
      }
    }

    if (FROZEN_LEGACY_PATHS.some((prefix) => path.startsWith(prefix))) {
      categories.frozenLegacy.push(path);
    }

    if (!matched) {
      categories.other.push(path);
    }
  }

  return categories;
}

function detectClaims(text) {
  return CLAIM_PATTERNS
    .filter((claim) => claim.pattern.test(text))
    .filter((claim) => claim.id !== 'docs_only' || !CODE_SCOPE_DISCLOSURE_PATTERN.test(text))
    .map(({ id, label }) => ({
      id,
      label,
    }));
}

function detectBehaviorSignals(diff) {
  const signals = [];
  let currentFile = '';

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('diff --git')) {
      currentFile = line.split(' b/')[1] || currentFile;
      continue;
    }

    if (BEHAVIOR_LINE_PATTERN.test(line)) {
      signals.push(`${currentFile}: ${line.slice(0, 160)}`);
    }
  }

  return signals;
}

function detectDeletedAssertions(diff) {
  const assertions = [];
  let currentFile = '';

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('diff --git')) {
      currentFile = line.split(' b/')[1] || currentFile;
      continue;
    }

    if (ASSERTION_LINE_PATTERN.test(line)) {
      assertions.push(`${currentFile}: ${line.slice(0, 160)}`);
    }
  }

  return assertions;
}

function detectRuleBasedMismatches({ claims, categories, behaviorSignals, signals }) {
  const claimIds = new Set(claims.map((claim) => claim.id));
  const mismatches = [];
  const codeFilesChanged =
    categories.controllers.length +
      categories.services.length +
      categories.models.length +
      categories.migrations.length +
      categories.businessRules.length +
      categories.routes.length >
    0;
  const behaviorSurfaceChanged =
    behaviorSignals.length > 0 ||
    categories.controllers.length > 0 ||
    categories.routes.length > 0 ||
    categories.migrations.length > 0 ||
    categories.businessRules.length > 0;

  if ((claimIds.has('refactor_only') || claimIds.has('no_behavior_change')) && behaviorSurfaceChanged) {
    mismatches.push({
      id: 'refactor_claim_but_behavior_signals',
      severity: 'high',
      claim: 'PR is framed as refactor/cleanup/no behavior change.',
      reality: 'Diff contains behavior-change signals or touches request, route, database, or business policy surface.',
      evidence: [
        ...behaviorSignals.slice(0, 4),
        ...categories.routes.slice(0, 2),
        ...categories.controllers.slice(0, 2),
        ...categories.migrations.slice(0, 2),
        ...categories.businessRules.slice(0, 2),
      ],
    });
  }

  if (claimIds.has('docs_only') && codeFilesChanged) {
    mismatches.push({
      id: 'docs_claim_but_code_changed',
      severity: 'high',
      claim: 'PR appears to be framed around docs.',
      reality: 'Application, database, or business policy files changed too.',
      evidence: [
        ...categories.controllers,
        ...categories.services,
        ...categories.models,
        ...categories.migrations,
        ...categories.routes,
        ...categories.businessRules,
      ].slice(0, 8),
    });
  }

  if (claimIds.has('test_only') && codeFilesChanged) {
    mismatches.push({
      id: 'test_claim_but_code_changed',
      severity: 'medium',
      claim: 'PR appears to be framed around tests.',
      reality: 'Application, database, or business policy files changed too.',
      evidence: [
        ...categories.controllers,
        ...categories.services,
        ...categories.models,
        ...categories.migrations,
        ...categories.routes,
        ...categories.businessRules,
      ].slice(0, 8),
    });
  }

  if (claimIds.has('small_change') && signals.some((signal) => signal.severity === 'high')) {
    mismatches.push({
      id: 'small_claim_but_high_risk',
      severity: 'medium',
      claim: 'PR language makes the change sound small.',
      reality: 'High-risk signals are present.',
      evidence: signals.filter((signal) => signal.severity === 'high').map((signal) => signal.title),
    });
  }

  return mismatches;
}

function attachSignalDisclosures(signals, text) {
  return signals.map((signal) => ({
    ...signal,
    disclosed: isSignalDisclosed(signal.id, text),
  }));
}

function isSignalDisclosed(signalId, text) {
  const normalized = text.toLowerCase();
  const patterns = {
    frozen_legacy_touched: [/\b(cb::series|frozen|legacy|read[-\s]?only)\b/i],
    migration_changed: [/\b(migration|database|db|schema|rollback|rollout|review_state)\b/i],
    dependencies_changed: [/\b(dependency|dependencies|gemfile|package\.json|lockfile|compatibility|security)\b/i],
    deleted_assertions: [/\b(assertion|assertions|test coverage|coverage|removed tests?|deleted tests?)\b/i],
    business_rules_changed: [
      /\b(business rule|business rules|policy|policies|refund|discount|coupon|pricing|billing|payment|approval|customer impact|rollout)\b/i,
    ],
    api_surface_without_docs: [/\b(api|controller|route|endpoint|request spec|request specs|api docs?|documentation|docs?)\b/i],
    service_without_tests: [/\b(service tests?|service specs?|unit tests?|tests? not included|tests? missing|should be added before)\b/i],
    controller_without_tests: [/\b(controller tests?|controller specs?|request specs?|integration tests?|tests? not included|tests? missing|should be added before)\b/i],
    behavior_signals: [
      /\b(behavior|behaviour|function|code|logic|implementation|access control|authorization|auth|permission|response shape|error handling|validation|hidden[-\s]?template|cannot be updated|reject)\b/i,
    ],
    ci_changed: [/\b(ci|cd|pipeline|workflow|github actions?|secrets?|required checks?)\b/i],
  };

  return (patterns[signalId] || []).some((pattern) => pattern.test(normalized));
}

function scoreTruth({ mismatches, signals, scoringMode }) {
  const deductions = [
    ...mismatches.map((mismatch) => ({
      source: 'claim_mismatch',
      id: mismatch.id,
      label: mismatch.claim,
      rubricLabel: lookupRubricRule('claim_mismatch', mismatch.id)?.label || mismatch.claim,
      severity: mismatch.severity,
      points: lookupRubricRule('claim_mismatch', mismatch.id)?.points || 0,
    })),
    ...signals
      .filter((signal) => !signal.disclosed)
      .map((signal) => ({
        source: 'missing_disclosure',
        id: signal.id,
        label: signal.title,
        rubricLabel: lookupRubricRule('missing_disclosure', signal.id)?.label || signal.title,
        severity: signal.severity,
        points: lookupRubricRule('missing_disclosure', signal.id)?.points || 0,
      })),
  ].filter((deduction) => deduction.points > 0);

  const totalDeducted = deductions.reduce((sum, deduction) => sum + deduction.points, 0);
  const score = Math.max(SCORE_RUBRIC.minimumScore, SCORE_RUBRIC.baseScore - totalDeducted);

  return {
    baseScore: SCORE_RUBRIC.baseScore,
    minimumScore: SCORE_RUBRIC.minimumScore,
    scoringMode,
    score,
    totalDeducted,
    deductions,
    rubric: {
      unit: SCORE_RUBRIC.unit,
      claimMismatchRules: cloneRubricRules(SCORE_RUBRIC.claimMismatchRules),
      missingDisclosureRules: cloneRubricRules(SCORE_RUBRIC.missingDisclosureRules),
      riskThresholds: [
        'High: any high-severity diff risk signal, or score < 60',
        'Medium: score < 82',
        'Low: score >= 82 with no high-severity diff risk signal',
      ],
    },
  };
}

function hasAiScoringDecisions(scoringDecisions) {
  return (
    (Array.isArray(scoringDecisions?.claimMismatches) && scoringDecisions.claimMismatches.length > 0) ||
    (Array.isArray(scoringDecisions?.signalDisclosures) && scoringDecisions.signalDisclosures.length > 0)
  );
}

function applyAiSignalDisclosures(signals, signalDisclosures = []) {
  const decisions = new Map(
    signalDisclosures
      .filter((decision) => typeof decision.disclosed === 'boolean')
      .map((decision) => [decision.id, decision]),
  );

  return signals.map((signal) => {
    const decision = decisions.get(signal.id);

    if (!decision) {
      return signal;
    }

    return {
      ...signal,
      disclosed: decision.disclosed,
      disclosureReason: decision.reason || '',
      evidence: mergeEvidence(signal.evidence, decision.evidence),
    };
  });
}

function buildAiMismatches({ baseMismatches, claimDecisions = [] }) {
  const baseById = new Map(baseMismatches.map((mismatch) => [mismatch.id, mismatch]));

  return claimDecisions
    .filter((decision) => decision.triggered === true)
    .filter((decision) => lookupRubricRule('claim_mismatch', decision.id))
    .map((decision) => {
      const base = baseById.get(decision.id);
      const rubric = lookupRubricRule('claim_mismatch', decision.id);

      return {
        id: decision.id,
        severity: base?.severity || CLAIM_MISMATCH_SEVERITY[decision.id] || 'medium',
        claim: decision.claim || base?.claim || rubric.label,
        reality: decision.reality || decision.reason || base?.reality || rubric.label,
        evidence: mergeEvidence(base?.evidence || [], decision.evidence),
        aiReason: decision.reason || '',
      };
    });
}

function mergeEvidence(...groups) {
  return Array.from(
    new Set(
      groups
        .flat()
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  ).slice(0, 8);
}

function lookupRubricRule(source, id) {
  if (source === 'claim_mismatch') {
    return SCORE_RUBRIC.claimMismatchRules[id];
  }

  if (source === 'missing_disclosure') {
    return SCORE_RUBRIC.missingDisclosureRules[id];
  }

  return null;
}

function cloneRubricRules(rules) {
  return Object.fromEntries(
    Object.entries(rules).map(([id, rule]) => [
      id,
      {
        points: rule.points,
        label: rule.label,
      },
    ]),
  );
}

function scoreToRisk(score, signals, mismatches) {
  if (
    signals.some((signal) => signal.severity === 'high') ||
    mismatches.some((mismatch) => mismatch.severity === 'high') ||
    score < 60
  ) {
    return 'high';
  }

  if (score < 82) {
    return 'medium';
  }

  return 'low';
}

function verdictFor({ truthScore, mismatches, signals, scoreBreakdown }) {
  if (mismatches.length > 0) {
    return 'Description may be incomplete. Reviewer should compare the PR claim with the evidence below.';
  }

  if (scoreBreakdown?.deductions.length > 0) {
    return 'No direct claim mismatch found, but the PR description is missing some risk disclosures.';
  }

  if (signals.some((signal) => signal.severity === 'high')) {
    return 'Description matches detected diff facts. Review risk remains high because high-risk files changed.';
  }

  if (truthScore < 90) {
    return 'Mostly honest, with a few review focus areas.';
  }

  return 'No obvious mismatch found by rule-based checks.';
}
