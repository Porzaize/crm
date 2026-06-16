export async function sendTelegram(chatId: string, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token || !chatId) return false
  try {
    const send = async (cid: string) => {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: cid, text, parse_mode: 'HTML' }),
      })
      return r.json()
    }

    let data = await send(chatId)

    if (!data.ok && data.parameters?.migrate_to_chat_id) {
      const newChatId = String(data.parameters.migrate_to_chat_id)
      console.log(`[Telegram] Group migrated: ${chatId} → ${newChatId}`)
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (url && serviceKey) {
        await fetch(`${url}/rest/v1/notification_settings?value=eq.${chatId}`, {
          method: 'PATCH',
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ value: newChatId }),
        }).catch(() => {})
      }
      data = await send(newChatId)
    }

    if (!data.ok) {
      console.error('[Telegram] API error:', data.description)
      return false
    }
    return true
  } catch (err) {
    console.error('[Telegram] send failed:', err)
    return false
  }
}

export async function getSetting(key: string, defaultVal = ''): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const res = await fetch(`${url}/rest/v1/notification_settings?key=eq.${key}&select=value`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  })
  const data = await res.json()
  return data?.[0]?.value ?? defaultVal
}
