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
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })

  const { data: custs } = await admin
    .from('customers')
    .select('site_id, answered, not_answered, total_deposit, sites(name)')
    .eq('call_date', today)

  const { data: sites } = await admin.from('sites').select('id, name').order('id')

  const total = custs?.length || 0
  const answered = custs?.filter(c => c.answered).length || 0
  const returned = custs?.filter(c => parseFloat(String(c.total_deposit || 0)) > 0).length || 0
  const deposit = custs?.reduce((s, c) => s + parseFloat(String(c.total_deposit || 0)), 0) || 0

  const slowSites: string[] = []
  for (const s of sites || []) {
    const sc = (custs || []).filter(c => c.site_id === s.id)
    if (sc.length < 5) {
      slowSites.push(`• ${s.name}: โทรแล้ว ${sc.length} ราย`)
    }
  }

  const dateDisplay = new Date().toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'full' })
  const timeDisplay = new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', timeStyle: 'short' })

  const lines = [
    `⚠️ <b>แจ้งเตือนช่วงบ่าย (Slow Day Alert)</b>`,
    `📅 ${dateDisplay} เวลา ${timeDisplay}`,
    ``,
    `📞 โทรแล้ววันนี้: <b>${total} ราย</b>`,
    `✅ รับสาย: <b>${answered}</b> (${total > 0 ? ((answered / total) * 100).toFixed(1) : 0}%)`,
    `💰 กลับมาฝาก: <b>${returned} ราย</b> | ฿${deposit.toLocaleString('th-TH', { maximumFractionDigits: 0 })}`,
  ]

  if (slowSites.length > 0) {
    lines.push(``, `🐌 <b>เว็บที่โทรน้อย (< 5 ราย):</b>`, ...slowSites)
  }

  if (total < 20) {
    lines.push(``, `🔴 <b>ยอดโทรรวมต่ำกว่าเป้า!</b> (${total}/20 ราย)`)
  } else if (answered / total < 0.3 && total > 0) {
    lines.push(``, `🟡 <b>อัตรารับสายต่ำ</b> (${((answered / total) * 100).toFixed(1)}%)`)
  } else {
    lines.push(``, `🟢 ผลงานช่วงเช้าปกติ`)
  }

  await sendTelegram(chatId, lines.join('\n'))
  return NextResponse.json({ ok: true, total, answered, returned, slowSites: slowSites.length })
}
