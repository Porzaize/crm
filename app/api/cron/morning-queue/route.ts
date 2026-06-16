import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { sendTelegram, getSetting } from '@/lib/telegram'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const chatId = await getSetting('team_chat_id', '')
  if (!chatId) return NextResponse.json({ error: 'ไม่มี team_chat_id' }, { status: 400 })

  const admin = createAdminClient()
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })

  const { data: callbacks } = await admin
    .from('customers')
    .select('phone, site_id, next_call_at, sites(name)')
    .lte('next_call_at', today + 'T23:59:59+07:00')
    .eq('do_not_call', false)
    .order('next_call_at')

  const { data: dnc } = await admin
    .from('customers')
    .select('id')
    .eq('do_not_call', true)

  const { data: sites } = await admin.from('sites').select('id, name').order('id')
  const { data: allCusts } = await admin
    .from('customers')
    .select('site_id, answered')
    .eq('call_date', today)

  const dateDisplay = new Date().toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'full' })
  const callbackCount = callbacks?.length || 0
  const dncCount = dnc?.length || 0

  const siteLines = (sites || []).map(s => {
    const sc = (allCusts || []).filter(c => c.site_id === s.id)
    return `• ${s.name}: ${sc.length} ราย (รับสาย ${sc.filter(c => c.answered).length})`
  })

  const lines = [
    `🌅 <b>สรุปงานเช้า (Morning Queue)</b>`,
    `📅 ${dateDisplay}`,
    ``,
    `📋 ลูกค้านัดโทรวันนี้: <b>${callbackCount} ราย</b>`,
    `🚫 ห้ามโทร (DNC): <b>${dncCount} ราย</b>`,
    ``,
    `📞 <b>สถานะโทรวันนี้:</b>`,
    ...siteLines,
  ]

  if (callbackCount > 0 && callbacks) {
    lines.push(``, `📌 <b>รายชื่อนัดโทร (ไม่เกิน 10):</b>`)
    callbacks.slice(0, 10).forEach((c, i) => {
      const siteName = (c as Record<string, unknown>).sites && typeof (c as Record<string, unknown>).sites === 'object' ? ((c as Record<string, unknown>).sites as Record<string, string>).name : ''
      lines.push(`${i + 1}. 0${c.phone} (${siteName})`)
    })
    if (callbackCount > 10) lines.push(`<i>...และอีก ${callbackCount - 10} ราย</i>`)
  }

  await sendTelegram(chatId, lines.join('\n'))
  return NextResponse.json({ ok: true, callbackCount, dncCount })
}
