Rails.application.routes.draw do
  namespace :cms_api do
    resources :templates, only: [:update] do
      post :preview, on: :member
    end
  end
end
