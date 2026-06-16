import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { sendTelegram, getSetting } from '@/lib/telegram'

export async function POST(req: NextRequest) {
  try {
    const { email, success, userId, userName, action } = await req.json()
    const admin = createAdminClient()
    let displayName = userName || ''
    if (userId && (!displayName || displayName === email)) {
      const { data: profile } = await admin.from('user_profiles').select('display_name, full_name').eq('id', userId).single()
      displayName = profile?.display_name || profile?.full_name || displayName
    }
    displayName = displayName || email || 'ไม่ทราบ'
    const auditAction = action === 'logout' ? 'auth.logout' : (success ? 'auth.login' : 'auth.login_failed')
    const statusLabel = action === 'logout' ? 'ออกจากระบบ' : (success ? 'สำเร็จ' : 'ล้มเหลว')
    await admin.from('audit_logs').insert({
      user_id: userId || null,
      user_name: displayName,
      action: auditAction,
      entity: 'Auth',
      entity_id: email || '-',
      before_data: null,
      after_data: { email, status: statusLabel },
    })
    try {
      const chatId = await getSetting('boss_chat_id', '')
      if (chatId) {
        const time = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' })
        if (action === 'logout') {
          await sendTelegram(chatId, `🔓 <b>ออกจากระบบ</b>\n\n👤 ${displayName}\n🕐 ${time}`)
        } else if (success) {
          await sendTelegram(chatId, `🔐 <b>เข้าสู่ระบบ</b>\n\n👤 ${displayName}\n🕐 ${time}`)
        } else {
          await sendTelegram(chatId, `⚠️ <b>เข้าสู่ระบบล้มเหลว</b>\n\n👤 ${displayName}\n🕐 ${time}`)
        }
      }
    } catch {}
  } catch {
    // never break the login flow
  }
  return NextResponse.json({ ok: true })
}
