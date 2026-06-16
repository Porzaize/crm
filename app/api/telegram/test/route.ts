import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerSupabase } from '@/lib/supabase-server'
import { sendTelegram } from '@/lib/telegram'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    const admin = createAdminClient()
    const { data: profile } = await admin.from('user_profiles').select('role').eq('id', user.id).single()
    const role = profile?.role || user.user_metadata?.role || ''
    if (role !== 'admin' && role !== 'manager') return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }

  const body = await req.json()
  const { chat_id, test_type } = body
  if (!chat_id) return NextResponse.json({ error: 'ไม่มี chat_id' }, { status: 400 })
  if (!process.env.TELEGRAM_BOT_TOKEN) return NextResponse.json({ error: 'ยังไม่ได้ตั้ง TELEGRAM_BOT_TOKEN ใน .env.local' }, { status: 400 })

  const time = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' })
  const messages: Record<string, string> = {
    login: `🔐 <b>เข้าสู่ระบบ</b>\n\n👤 test@example.com\n🕐 ${time}`,
    login_fail: `⚠️ <b>เข้าสู่ระบบล้มเหลว</b>\n\n👤 unknown@example.com\n🕐 ${time}`,
    logout: `🔓 <b>ออกจากระบบ</b>\n\n👤 test@example.com\n🕐 ${time}`,
    big_deposit: `💰 <b>ยอดฝากใหญ่!</b>\n\n🌐 มรกต\n📞 0812345678\n💵 ฿50,000\n👤 ทดสอบ`,
    dnc: `🚫 <b>ตั้งห้ามโทร</b>\n\n🌐 มรกต\n📞 0812345678\n📝 ลูกค้าแจ้งไม่ต้องการ\n👤 ทดสอบ`,
    bonus: `🎁 <b>ปรับโบนัสพนักงาน</b>\n\n👤 ทดสอบ\n💵 ฿2,000 → ฿3,000\n📝 ผลงานดี\n🔧 เจ้านาย`,
    user_create: `👤 <b>สร้างผู้ใช้ใหม่</b>\n\n📧 new@example.com\n🏷 editor`,
    user_delete: `🗑 <b>ลบผู้ใช้</b>\n\n🆔 test-user-id`,
    role_change: `🔄 <b>เปลี่ยนสิทธิ์</b>\n\n👤 ทดสอบ\n🏷 → admin`,
  }

  try {
    const msg = (test_type && messages[test_type]) ? messages[test_type] : `✅ <b>ทดสอบ CRM</b>\n\n🕐 ${time}\nระบบแจ้งเตือนทำงานปกติ`
    const token = process.env.TELEGRAM_BOT_TOKEN!

    const sendMsg = async (cid: string) => {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: cid, text: msg, parse_mode: 'HTML' }),
      })
      return r.json()
    }

    let data = await sendMsg(chat_id)

    if (!data.ok && data.parameters?.migrate_to_chat_id) {
      const newChatId = String(data.parameters.migrate_to_chat_id)
      data = await sendMsg(newChatId)
      if (data.ok) {
        const admin = createAdminClient()
        const chatKey = body.chat_key || (chat_id === body.chat_id ? null : null)
        await admin.from('notification_settings').update({ value: newChatId }).eq('value', chat_id)
        return NextResponse.json({ ok: true, new_chat_id: newChatId, migrated: true })
      }
    }

    if (!data.ok) {
      return NextResponse.json({ error: `Telegram API: ${data.description || 'Unknown error'}` }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: `ส่งไม่สำเร็จ: ${err.message || 'Unknown error'}` }, { status: 500 })
  }
}
