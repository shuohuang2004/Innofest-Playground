class AddTemplateReviewState < ActiveRecord::Migration[8.0]
  def change
    add_column :templates, :review_state, :string, default: 'draft'
  end
end
