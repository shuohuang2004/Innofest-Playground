module TemplateService
  class UpdateTemplate
    def call(template, params)
      if template.hidden?
        return Failure.new(:hidden_template)
      end

      return Success.new(template) if template.update(params)

      Failure.new(:invalid_template)
    end
  end
end
