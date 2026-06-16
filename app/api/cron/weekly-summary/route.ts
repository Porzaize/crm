import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { sendTelegram, getSetting } from '@/lib/telegram'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const chatId = await getSetting('boss_chat_id', '')
  if (!chatId) return NextResponse.json({ error: 'ไม่มี boss_chat_id' }, { status: 400 })

  const admin = createAdminClient()
  const { data: weekly } = await admin.from('weekly_summary').select('*, sites(name)').order('site_id')

  const totalCalls = weekly?.reduce((s, w) => s + (w.total_calls || 0), 0) || 0
  const totalAnswered = weekly?.reduce((s, w) => s + (w.answered || 0), 0) || 0
  const totalReturned = weekly?.reduce((s, w) => s + (w.return_customers || 0), 0) || 0
  const totalDeposit = weekly?.reduce((s, w) => s + parseFloat(String(w.return_deposit || 0)), 0) || 0
  const totalBonus = weekly?.reduce((s, w) => s + parseFloat(String(w.bonus || 0)), 0) || 0

  const lines = [
    `📈 <b>สรุปผลรายสัปดาห์</b>`,
    ``,
    `📞 โทรทั้งหมด: <b>${totalCalls.toLocaleString()}</b> ราย`,
    `✅ รับสาย: <b>${totalAnswered.toLocaleString()}</b> (${totalCalls > 0 ? ((totalAnswered / totalCalls) * 100).toFixed(1) : 0}%)`,
    `💰 กลับมาฝาก: <b>${totalReturned.toLocaleString()} ราย</b>`,
    `💵 ยอดฝากรวม: <b>฿${totalDeposit.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</b>`,
    `🎁 โบนัสรวม: <b>฿${totalBonus.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</b>`,
    `📊 ROI: <b>${totalDeposit > 0 ? ((totalBonus / totalDeposit) * 100).toFixed(1) : 0}%</b>`,
    ``,
    ...(weekly || []).map(w => `• ${w.sites?.name}: โทร ${w.total_calls} | ฝาก ฿${parseFloat(String(w.return_deposit || 0)).toLocaleString('th-TH', { maximumFractionDigits: 0 })}`),
  ]

  await sendTelegram(chatId, lines.join('\n'))
  return NextResponse.json({ ok: true })
}
