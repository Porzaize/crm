export interface Site {
  id: number
  name: string
}

export interface Customer {
  id: number
  site_id: number
  seq: number
  phone: string
  call_date: string
  call_time: string
  answered: boolean
  not_answered: boolean
  sms_sent: boolean
  total_deposit: number
  note: string
  created_at?: string
  next_call_at?: string | null
  do_not_call?: boolean
  do_not_call_reason?: string | null
  called_by?: string | null
  promo_type?: string | null
  call_count?: number
  sites?: { name: string }
}

export interface AuditLog {
  id: number
  user_id: string
  user_name: string
  action: string
  entity: string
  entity_id: string
  before_data: Record<string, unknown> | null
  after_data: Record<string, unknown> | null
  created_at: string
}

export interface SmsTemplate {
  id: number
  name: string
  body: string
  active: boolean
  sort_order: number
  created_at: string
}

export interface NotificationSetting {
  id: number
  key: string
  value: string
}

export interface DailyDeposit {
  id: number
  customer_id: number
  day_number: number
  deposit_amount: number
}

export interface WeeklySummary {
  id: number
  site_id: number
  week_start: string
  week_end: string
  total_calls: number
  answered: number
  not_answered: number
  return_customers: number
  return_deposit: number
  bonus: number
  sites?: { name: string }
}

export interface UserProfile {
  id: string
  full_name: string
  role: 'admin' | 'manager' | 'editor' | 'viewer'
  site_access: string[] | null
  phone?: string | null
  is_active?: boolean
  created_at: string
  email?: string
  last_sign_in_at?: string | null
}

export interface CustomerWithDeposits extends Customer {
  daily_deposits: number[]
}
