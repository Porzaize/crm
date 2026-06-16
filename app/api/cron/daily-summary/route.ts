import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { sendTelegram, getSetting } from '@/lib/telegram'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const enabled = await getSetting('daily_summary_enabled', 'true')
  if (enabled !== 'true') return NextResponse.json({ ok: true, skipped: true })

  const chatId = await getSetting('team_chat_id', '')
  if (!chatId) return NextResponse.json({ error: 'ไม่มี team_chat_id' }, { status: 400 })

  const admin = createAdminClient()
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })

  const { data: custs } = await admin.from('customers').select('answered, not_answered, sms_sent, total_deposit').eq('call_date', today)
  const { data: sites } = await admin.from('sites').select('id, name').order('id')
  const { data: weekly } = await admin.from('weekly_summary').select('*, sites(name)')

  const total = custs?.length || 0
  const answered = custs?.filter(c => c.answered).length || 0
  const sms = custs?.filter(c => c.sms_sent).length || 0
  const returned = custs?.filter(c => parseFloat(String(c.total_deposit || 0)) > 0).length || 0
  const deposit = custs?.reduce((s, c) => s + parseFloat(String(c.total_deposit || 0)), 0) || 0
  const bonus = weekly?.reduce((s, w) => s + parseFloat(String(w.bonus || 0)), 0) || 0

  const dateDisplay = new Date().toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'full' })

  const lines = [
    `📊 <b>สรุปผลประจำวัน</b>`,
    `📅 ${dateDisplay}`,
    ``,
    `📞 โทรทั้งหมด: <b>${total.toLocaleString()}</b> ราย`,
    `✅ รับสาย: <b>${answered.toLocaleString()}</b> (${total > 0 ? ((answered / total) * 100).toFixed(1) : 0}%)`,
    `💬 ส่ง SMS: <b>${sms.toLocaleString()}</b> ราย`,
    `💰 กลับมาฝาก: <b>${returned.toLocaleString()} ราย</b> | ฿${deposit.toLocaleString('th-TH', { maximumFractionDigits: 0 })}`,
    `🎁 โบนัสรวม: <b>฿${bonus.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</b>`,
    ``,
    `<i>${(sites || []).length} เว็บ</i>`,
  ]

  await sendTelegram(chatId, lines.join('\n'))
  return NextResponse.json({ ok: true, total, answered, returned })
}
