export function notifyTelegram(type: string, data: Record<string, unknown>) {
  fetch('/api/telegram/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, data }),
  }).catch(() => {})
}
