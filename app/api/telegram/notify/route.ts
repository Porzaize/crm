import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { sendTelegram, getSetting } from '@/lib/telegram'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }

  const { type, data } = await req.json()

  try {
    if (type === 'big_deposit') {
      const enabled = await getSetting('big_deposit_enabled', 'false')
      if (enabled !== 'true') return NextResponse.json({ ok: true, skipped: true })
      const threshold = parseFloat(await getSetting('big_deposit_threshold', '5000'))
      const deposit = parseFloat(data.deposit || 0)
      if (deposit < threshold) return NextResponse.json({ ok: true, skipped: true })
      const chatId = await getSetting('team_chat_id', '')
      if (!chatId) return NextResponse.json({ ok: true, skipped: true })
      const msg = [
        `💰 <b>ยอดฝากใหญ่!</b>`,
        ``,
        `🌐 ${data.site || '-'}`,
        `📞 0${data.phone || '-'}`,
        `💵 ฿${deposit.toLocaleString('th-TH', { maximumFractionDigits: 0 })}`,
        data.by ? `👤 ${data.by}` : '',
      ].filter(Boolean).join('\n')
      await sendTelegram(chatId, msg)
    }

    if (type === 'bonus') {
      const chatId = await getSetting('boss_chat_id', '')
      if (!chatId) return NextResponse.json({ ok: true, skipped: true })
      const msg = [
        `🎁 <b>ปรับโบนัสพนักงาน</b>`,
        ``,
        `👤 ${data.agent || '-'}`,
        `💵 ฿${Number(data.oldAmount || 0).toLocaleString()} → ฿${Number(data.newAmount || 0).toLocaleString()}`,
        data.note ? `📝 ${data.note}` : '',
        data.by ? `🔧 ${data.by}` : '',
      ].filter(Boolean).join('\n')
      await sendTelegram(chatId, msg)
    }

    if (type === 'dnc') {
      const enabled = await getSetting('dnc_enabled', 'false')
      if (enabled !== 'true') return NextResponse.json({ ok: true, skipped: true })
      const chatId = await getSetting('boss_chat_id', '')
      if (!chatId) return NextResponse.json({ ok: true, skipped: true })
      const msg = [
        `🚫 <b>ตั้งห้ามโทร</b>`,
        ``,
        `🌐 ${data.site || '-'}`,
        `📞 0${data.phone || '-'}`,
        `📝 ${data.reason || '-'}`,
        data.by ? `👤 ${data.by}` : '',
      ].filter(Boolean).join('\n')
      await sendTelegram(chatId, msg)
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: true })
  }
}
