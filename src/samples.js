import { UserFacingError } from './errors.js';

const SAMPLES = {
  'risky-refactor': {
    title: 'Refactor template update service',
    body: [
      '## Summary',
      '',
      'Small cleanup in TemplateService. No behavior change expected.',
      '',
      '## Verification',
      '',
      '- CI',
    ].join('\n'),
    gitFacts: {
      repo: 'sample://risky-refactor',
      requestedRange: 'sample',
      range: 'sample:risky-refactor',
      warnings: [],
      changedFiles: [
        { status: 'M', path: 'app/services/template_service/update_template.rb' },
        { status: 'M', path: 'app/controllers/cms_api/templates_controller.rb' },
        { status: 'M', path: 'config/routes.rb' },
        { status: 'M', path: 'test/services/template_service/update_template_test.rb' },
      ],
      stats: [
        ' app/services/template_service/update_template.rb      | 18 ++++++++++---',
        ' app/controllers/cms_api/templates_controller.rb       |  6 +++--',
        ' config/routes.rb                                      |  2 ++',
        ' test/services/template_service/update_template_test.rb |  4 ----',
        ' 4 files changed, 20 insertions(+), 10 deletions(-)',
      ].join('\n'),
      commits: 'abc1234 Refactor template update service',
      diff: [
        'diff --git a/app/services/template_service/update_template.rb b/app/services/template_service/update_template.rb',
        '-    return Success.new(template) if template.update(params)',
        '+    if template.hidden?',
        '+      return Failure.new(:hidden_template)',
        '+    end',
        '+',
        '+    return Success.new(template) if template.update(params)',
        '+',
        '+    Failure.new(:invalid_template)',
        'diff --git a/app/controllers/cms_api/templates_controller.rb b/app/controllers/cms_api/templates_controller.rb',
        '-    render json: presenter.as_json',
        '+    render json: { error: result.error }, status: :unprocessable_entity',
        'diff --git a/config/routes.rb b/config/routes.rb',
        '+    post :preview',
        'diff --git a/test/services/template_service/update_template_test.rb b/test/services/template_service/update_template_test.rb',
        '-    assert_equal old_title, template.title',
      ].join('\n'),
      diffExcerpt: '',
      diffTruncated: false,
    },
  },
};

for (const sample of Object.values(SAMPLES)) {
  sample.gitFacts.diffExcerpt = sample.gitFacts.diff;
}

export function loadSample(name) {
  const sample = SAMPLES[name];

  if (!sample) {
    throw new UserFacingError(`Unknown sample: ${name}. Available samples: ${Object.keys(SAMPLES).join(', ')}`);
  }

  return structuredClone(sample);
}
