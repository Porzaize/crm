import { createAdminClient, createServerSupabase } from '@/lib/supabase-server'

async function resolveUserName(): Promise<{ id: string; name: string } | null> {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const admin = createAdminClient()
    const { data: profile } = await admin.from('user_profiles').select('full_name').eq('id', user.id).single()
    return { id: user.id, name: profile?.full_name || user.user_metadata?.full_name || user.email || '' }
  } catch { return null }
}

export async function logAuditServer(params: {
  userId?: string | null
  userName?: string
  action: string
  entity: string
  entityId: string | number
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}) {
  try {
    let userId = params.userId || null
    let userName = params.userName || ''

    if (!userName) {
      const resolved = await resolveUserName()
      if (resolved) {
        userId = userId || resolved.id
        userName = resolved.name
      } else {
        userName = 'ระบบ'
      }
    }

    const admin = createAdminClient()
    await admin.from('audit_logs').insert({
      user_id: userId,
      user_name: userName,
      action: params.action,
      entity: params.entity,
      entity_id: String(params.entityId),
      before_data: params.before || null,
      after_data: params.after || null,
    })
  } catch {
    // audit logging must never break the main operation
  }
}
