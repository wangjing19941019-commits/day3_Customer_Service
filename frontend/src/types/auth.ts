export type UserRole =
  | 'employee'
  | 'frontline_agent'
  | 'after_sales_specialist'
  | 'senior_after_sales'
  | 'supervisor'
  | 'after_sales_supervisor'
  | 'cs_lead'
  | 'logistics_after_sales'
  | 'cs_supervisor'
  | 'admin'

export type SessionCreate = {
  username: string
  password: string
}

export type SessionPublic = {
  access_token: string
  token_type: 'bearer'
  username: string
  role: UserRole
}

export type CurrentSessionData = {
  username: string
  role: UserRole
}
