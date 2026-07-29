module CmsApi
  class TemplatesController
    def update
      result = TemplateService::UpdateTemplate.new.call(template, params)

      if result.failure?
        return render json: { error: result.error }, status: :unprocessable_entity
      end

      render json: result.value
    end
  end
end
