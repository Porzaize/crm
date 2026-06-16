import { createClient } from '@/lib/supabase-client'

export async function logAudit(params: {
  action: string
  entity: string
  entityId: string | number
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    let userName = ''
    if (user) {
      const { data: profile } = await supabase.from('user_profiles').select('full_name').eq('id', user.id).single()
      userName = profile?.full_name || user.user_metadata?.full_name || user.email || ''
    }

    const before = params.before ? pickChanged(params.before, params.after || {}) : null
    const after = params.after ? pickChanged(params.after, params.before || {}) : null

    await supabase.from('audit_logs').insert({
      user_id: user?.id || null,
      user_name: userName,
      action: params.action,
      entity: params.entity,
      entity_id: String(params.entityId),
      before_data: before,
      after_data: after,
    })
  } catch {
    // audit logging must never break the main operation
  }
}

function pickChanged(obj: Record<string, unknown>, other: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (other[k] !== v) result[k] = v
  }
  return Object.keys(result).length > 0 ? result : obj
}
