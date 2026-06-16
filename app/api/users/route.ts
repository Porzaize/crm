import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerSupabase } from '@/lib/supabase-server'
import { logAuditServer } from '@/lib/audit-server'
import { sendTelegram, getSetting } from '@/lib/telegram'

async function notifyBoss(msg: string) {
  try {
    const chatId = await getSetting('boss_chat_id', '')
    if (chatId) await sendTelegram(chatId, msg)
  } catch {}
}

async function getCallerRole(): Promise<{ id: string; role: string } | null> {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const admin = createAdminClient()
    const { data: profile } = await admin.from('user_profiles').select('role').eq('id', user.id).single()
    return { id: user.id, role: profile?.role || user.user_metadata?.role || '' }
  } catch { return null }
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const admin = createAdminClient()

  if (body.action !== 'setup') {
    const caller = await getCallerRole()
    if (!caller || (caller.role !== 'admin' && caller.role !== 'manager')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
  }

  if (body.action === 'setup') {
    // Check if any users exist
    const { data: existingUsers } = await admin.from('user_profiles').select('id').limit(1)
    if (existingUsers && existingUsers.length > 0) {
      return NextResponse.json({ error: 'ระบบมีผู้ใช้แล้ว ไม่สามารถตั้งค่าซ้ำได้' }, { status: 403 })
    }
    const { data, error } = await admin.auth.admin.createUser({
      email: body.email, password: body.password,
      user_metadata: { full_name: body.full_name, role: 'admin' },
      email_confirm: true,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    await admin.from('user_profiles').upsert({
      id: data.user.id, full_name: body.full_name, role: 'admin'
    })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'create') {
    const { data, error } = await admin.auth.admin.createUser({
      email: body.email, password: body.password,
      user_metadata: { full_name: body.full_name, role: body.role },
      email_confirm: true,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    const { error: profileErr } = await admin.from('user_profiles').upsert({
      id: data.user.id, full_name: body.full_name,
      role: body.role || 'viewer', site_access: body.site_access || null
    })
    if (profileErr) return NextResponse.json({ error: 'สร้าง Auth สำเร็จ แต่บันทึก Profile ผิดพลาด: ' + profileErr.message }, { status: 400 })
    logAuditServer({ action: 'user.create', entity: 'User', entityId: data.user.id, after: { email: body.email, full_name: body.full_name, role: body.role || 'viewer' } })
    notifyBoss(`👤 <b>สร้างผู้ใช้ใหม่</b>\n\n📧 ${body.email}\n🏷 ${body.role || 'viewer'}`)
    return NextResponse.json({ ok: true, id: data.user.id })
  }

  if (body.action === 'update') {
    const updates: Record<string, unknown> = {}
    if (body.full_name) updates.full_name = body.full_name
    if (body.role) updates.role = body.role
    if ('site_access' in body) updates.site_access = body.site_access
    if ('phone' in body) updates.phone = body.phone
    if ('is_active' in body) updates.is_active = body.is_active
    await admin.from('user_profiles').update(updates).eq('id', body.id)

    if (body.password) {
      await admin.auth.admin.updateUserById(body.id, { password: body.password })
      logAuditServer({ action: 'user.reset_password', entity: 'User', entityId: body.id, after: { action: 'มีการรีเซ็ตรหัสผ่าน' } })
    }
    if (body.email) {
      await admin.auth.admin.updateUserById(body.id, { email: body.email })
    }
    logAuditServer({ action: 'user.update', entity: 'User', entityId: body.id, after: updates })
    if (body.role) notifyBoss(`🔄 <b>เปลี่ยนสิทธิ์</b>\n\n👤 ${body.full_name || body.id}\n🏷 → ${body.role}`)
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'delete') {
    await admin.auth.admin.deleteUser(body.id)
    await admin.from('user_profiles').delete().eq('id', body.id)
    logAuditServer({ action: 'user.delete', entity: 'User', entityId: body.id, before: { id: body.id } })
    notifyBoss(`🗑 <b>ลบผู้ใช้</b>\n\n🆔 ${body.id}`)
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'list') {
    const { data: profiles } = await admin.from('user_profiles').select('*').order('created_at')
    const { data: { users } } = await admin.auth.admin.listUsers()
    const merged = (profiles || []).map(p => {
      const u = users.find(u => u.id === p.id)
      return { ...p, email: u?.email || '', last_sign_in_at: u?.last_sign_in_at || null }
    })
    return NextResponse.json({ users: merged })
  }

  return NextResponse.json({ error: 'invalid action' }, { status: 400 })
}

export async function GET() {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  const admin = createAdminClient()
  const { data: profiles } = await admin.from('user_profiles').select('*').order('created_at')
  const { data: { users } } = await admin.auth.admin.listUsers()
  const merged = (profiles || []).map(p => {
    const u = users.find(u => u.id === p.id)
    return { ...p, email: u?.email || '', last_sign_in_at: u?.last_sign_in_at || null }
  })
  return NextResponse.json({ users: merged })
}
