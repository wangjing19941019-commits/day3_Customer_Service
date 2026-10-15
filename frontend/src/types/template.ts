export type TemplateScene = 'pre_sale' | 'after_sale' | 'in_transit'

export type PromptTemplateListItem = {
  id: string
  business_line: string
  ticket_type: string
  scene: TemplateScene
  stable_version: number
  gray_version: number | null
  gray_percent: number
}

export type PromptTemplatePublic = {
  id: string
  business_line: string
  ticket_type: string
  scene: TemplateScene
  body: string
  placeholder_notes: string
  stable_version: number
  gray_version: number | null
  gray_percent: number
  latest_version: number
}

export type PromptTemplateUpdate = {
  body: string
  change_summary: string
}

export type PromptTemplateVersionPublic = {
  version: number
  editor: string
  edited_at: string
  change_summary: string
}

export type PromptTemplateVersionRecord = PromptTemplateVersionPublic & {
  body: string
}

export type PromptTemplateVersionsPublic = {
  versions: PromptTemplateVersionRecord[]
  diff: string | null
}

export type PromptTemplatePreviewRequest = {
  sample_utterance: string
}

export type PromptTemplatePreviewPublic = {
  rendered_body: string
}

export type PromptTemplateReleaseCreate = {
  version: number
  gray_percent: number
}

export type PromptTemplateReleasePublic = {
  template_id: string
  gray_version: number | null
  stable_version: number
  gray_percent: number
}

export type PromptTemplateRollback = {
  to_version?: number | null
}

/** null means no samples yet. */
export type TemplateMetricsSlice = {
  extraction_accuracy: number | null
  adoption_rate: number | null
  compliance_intercept_rate: number | null
  modification_rate: number | null
  complaint_rate: number | null
}

export type TemplateMetricsPublic = TemplateMetricsSlice & {
  feedback_summary: string
  stable_version: number
  gray_version: number | null
  stable: TemplateMetricsSlice | null
  gray: TemplateMetricsSlice | null
}

export type EvaluationSetPublic = {
  id: string
  item_count: number
}

export type EvaluationSetCurrentPublic = {
  id: string | null
  item_count: number
}

export type TemplateAlertPublic = {
  template_id: string
  metric: 'compliance_intercept_rate'
  message: string
  created_at: string
}

export type TemplateAlertsPublic = {
  alerts: TemplateAlertPublic[]
}

export type WorkspaceSettingsPublic = {
  high_risk_amount_threshold: number | null
}

export type WorkspaceSettingsUpdate = {
  high_risk_amount_threshold: number | null
}
