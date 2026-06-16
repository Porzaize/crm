'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'

interface Setting { key: string; label: string; desc: string; type: 'text' | 'number' | 'toggle' }

const SETTINGS: Setting[] = [
  { key: 'team_chat_id', label: 'Chat ID กลุ่มทีม', desc: 'ID กลุ่ม Telegram ของทีมงาน (เลขติดลบสำหรับกลุ่ม)', type: 'text' },
  { key: 'boss_chat_id', label: 'Chat ID กลุ่มหัวหน้า', desc: 'ID กลุ่ม Telegram ของหัวหน้าทีม', type: 'text' },
  { key: 'big_deposit_threshold', label: 'เกณฑ์ยอดฝากใหญ่ (฿)', desc: 'แจ้งเตือนเมื่อยอดฝากถึงจำนวนนี้', type: 'number' },
  { key: 'daily_summary_enabled', label: 'สรุปรายวัน (20:00)', desc: 'ส่งสรุปผลประจำวันให้กลุ่มทีมทุกวัน', type: 'toggle' },
  { key: 'big_deposit_enabled', label: 'แจ้งเตือนยอดฝากใหญ่', desc: 'แจ้งเตือนทันทีเมื่อมียอดฝากใหญ่', type: 'toggle' },
  { key: 'dnc_enabled', label: 'แจ้งเตือนตั้งห้ามโทร', desc: 'แจ้งกลุ่มหัวหน้าเมื่อมีการตั้ง DNC', type: 'toggle' },
]

export default function NotificationsPage() {
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState({ msg: '', type: '' })
  const [testResult, setTestResult] = useState('')
  const [userRole, setUserRole] = useState('')
  const supabase = createClient()

  useEffect(() => { load(); loadRole() }, [])

  async function loadRole() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const saved = localStorage.getItem('impersonate_role')
    const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', user.id).single()
    const real = profile?.role || user.user_metadata?.role || ''
    if (saved && (real === 'manager' || real === 'admin')) setUserRole(saved)
    else setUserRole(real)
  }
  async function load() {
    setLoading(true)
    const { data } = await supabase.from('notification_settings').select('*')
    const map: Record<string, string> = {}
    for (const r of data || []) map[r.key] = r.value
    setValues(map)
    setLoading(false)
  }

  async function handleSave() {
    setSaving(true)
    for (const [key, value] of Object.entries(values)) {
      await supabase.from('notification_settings').upsert({ key, value }, { onConflict: 'key' })
    }
    setSaving(false)
    setToast({ msg: 'บันทึกสำเร็จ', type: 'success' })
    setTimeout(() => setToast({ msg: '', type: '' }), 2000)
  }

  async function testSend(chatKey: string, testType?: string) {
    const chatId = values[chatKey]
    if (!chatId) { setTestResult(`❌ กรุณากรอก ${chatKey === 'team_chat_id' ? 'Chat ID กลุ่มทีม' : 'Chat ID กลุ่มหัวหน้า'} ก่อน แล้วกดบันทึก`); return }
    setTestResult('⏳ กำลังส่ง...')
    try {
      const res = await fetch('/api/telegram/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, test_type: testType }) })
      const data = await res.json()
      if (data.ok && data.migrated && data.new_chat_id) {
        setValues(v => ({ ...v, [chatKey]: data.new_chat_id }))
        setTestResult(`✅ ส่งสำเร็จ! Chat ID ถูกอัปเดตอัตโนมัติเป็น ${data.new_chat_id} (กลุ่มถูกอัปเกรดเป็น supergroup)`)
      } else if (data.ok) {
        setTestResult('✅ ส่งสำเร็จ! ตรวจสอบใน Telegram')
      } else {
        setTestResult(`❌ ส่งไม่สำเร็จ: ${data.error}`)
      }
    } catch (err: any) {
      setTestResult(`❌ เกิดข้อผิดพลาด: ${err.message || 'ไม่สามารถเชื่อมต่อได้'}`)
    }
    setTimeout(() => setTestResult(''), 8000)
  }

  return (
    <div>
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '13px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50 }}>
        <div>
          <h2 style={{ fontSize: '15px', fontWeight: 600 }}>📱 ตั้งค่าการแจ้งเตือน Telegram</h2>
          <p style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>TELEGRAM_BOT_TOKEN ต้องตั้งใน .env.local</p>
        </div>
        {userRole !== 'viewer' && <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>{saving ? 'กำลังบันทึก...' : '💾 บันทึก'}</button>}
      </div>

      <div style={{ padding: '24px', maxWidth: '640px' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text3)', justifyContent: 'center', height: '200px' }}><div className="spinner" /> กำลังโหลด...</div>
        ) : (
          <>
            <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '12px', padding: '18px', marginBottom: '24px', fontSize: '13px', color: '#0c4a6e', lineHeight: 1.8 }}>
              <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '10px' }}>📖 วิธีตั้งค่า Telegram Bot</div>
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontWeight: 700, marginBottom: '4px' }}>ขั้นตอนที่ 1 — สร้างกลุ่ม Telegram</div>
                <div>1. เปิดแอป Telegram กดเมนู <b>New Group</b></div>
                <div>2. ตั้งชื่อกลุ่ม เช่น <b>"CRM แจ้งเตือนทีม"</b> และ <b>"CRM แจ้งเตือนหัวหน้า"</b></div>
                <div>3. เพิ่มสมาชิกทีมงานที่ต้องการรับแจ้งเตือนเข้ากลุ่ม</div>
              </div>
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontWeight: 700, marginBottom: '4px' }}>ขั้นตอนที่ 2 — สร้าง Bot</div>
                <div>1. ค้นหา <b>@BotFather</b> ใน Telegram</div>
                <div>2. พิมพ์ <code style={{ background: '#e0f2fe', padding: '1px 6px', borderRadius: '4px' }}>/newbot</code> แล้วตั้งชื่อบอท</div>
                <div>3. BotFather จะให้ <b>Token</b> มา (เช่น <code style={{ background: '#e0f2fe', padding: '1px 6px', borderRadius: '4px' }}>123456:ABC-DEF...</code>)</div>
                <div>4. นำ Token ไปตั้งค่าใน Vercel Environment Variables ชื่อ <code style={{ background: '#e0f2fe', padding: '1px 6px', borderRadius: '4px' }}>TELEGRAM_BOT_TOKEN</code></div>
              </div>
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontWeight: 700, marginBottom: '4px' }}>ขั้นตอนที่ 3 — เพิ่มบอทเข้ากลุ่มและหา Chat ID</div>
                <div>1. เปิดกลุ่มที่สร้างไว้ → กด <b>Add Member</b> → ค้นหาชื่อบอทแล้วเพิ่มเข้ากลุ่ม</div>
                <div>2. ส่งข้อความอะไรก็ได้ในกลุ่ม (เช่น "สวัสดี")</div>
                <div>3. เปิดลิงก์นี้ในเบราว์เซอร์ (แทน TOKEN ด้วย Token จริง):</div>
                <div style={{ background: '#e0f2fe', padding: '6px 10px', borderRadius: '6px', marginTop: '4px', fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all' }}>
                  https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates
                </div>
                <div style={{ marginTop: '4px' }}>4. หาค่า <code style={{ background: '#e0f2fe', padding: '1px 6px', borderRadius: '4px' }}>{'"chat":{"id":-100xxx}'}</code> → เลขติดลบนั้นคือ <b>Chat ID</b></div>
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: '4px' }}>ขั้นตอนที่ 4 — ตั้งค่าด้านล่าง</div>
                <div>นำ Chat ID มาวางในช่องด้านล่าง แล้วกด <b>"ทดสอบ"</b> เพื่อตรวจสอบว่าบอทส่งข้อความเข้ากลุ่มได้</div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {SETTINGS.map(s => (
                <div key={s.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', justifyContent: 'space-between' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>{s.label}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>{s.desc}</div>
                  </div>
                  {s.type === 'toggle' ? (
                    <button
                      type="button"
                      onClick={() => userRole !== 'viewer' && setValues(v => ({ ...v, [s.key]: v[s.key] === 'true' ? 'false' : 'true' }))}
                      disabled={userRole === 'viewer'}
                      style={{ padding: '6px 16px', borderRadius: '20px', border: 'none', cursor: userRole === 'viewer' ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '13px', background: values[s.key] === 'true' ? '#dcfce7' : '#f3f4f6', color: values[s.key] === 'true' ? '#15803d' : '#6b7280', opacity: userRole === 'viewer' ? 0.6 : 1 }}
                    >
                      {values[s.key] === 'true' ? 'เปิด' : 'ปิด'}
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <input
                        type={s.type}
                        value={values[s.key] || ''}
                        onChange={e => userRole !== 'viewer' && setValues(v => ({ ...v, [s.key]: e.target.value }))}
                        readOnly={userRole === 'viewer'}
                        style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 10px', borderRadius: '8px', fontSize: '13px', width: '200px', opacity: userRole === 'viewer' ? 0.6 : 1 }}
                        placeholder={s.key.includes('chat') ? '-100123456789' : '5000'}
                      />
                      {s.key.includes('chat') && userRole !== 'viewer' && (
                        <button className="btn btn-outline btn-sm" onClick={() => testSend(s.key)}>ทดสอบ</button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {userRole !== 'viewer' && <div style={{ marginTop: '28px', borderTop: '1px solid var(--border)', paddingTop: '20px' }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', marginBottom: '14px' }}>🧪 ทดสอบแจ้งเตือนแต่ละประเภท</div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[
                  { type: 'login', label: '🔐 เข้าสู่ระบบ', chat: 'boss_chat_id' },
                  { type: 'login_fail', label: '⚠️ เข้าสู่ระบบล้มเหลว', chat: 'boss_chat_id' },
                  { type: 'logout', label: '🔓 ออกจากระบบ', chat: 'boss_chat_id' },
                  { type: 'big_deposit', label: '💰 ยอดฝากใหญ่', chat: 'team_chat_id' },
                  { type: 'dnc', label: '🚫 ห้ามโทร', chat: 'boss_chat_id' },
                  { type: 'bonus', label: '🎁 ปรับโบนัส', chat: 'boss_chat_id' },
                  { type: 'user_create', label: '👤 สร้างผู้ใช้', chat: 'boss_chat_id' },
                  { type: 'role_change', label: '🔄 เปลี่ยนสิทธิ์', chat: 'boss_chat_id' },
                  { type: 'user_delete', label: '🗑 ลบผู้ใช้', chat: 'boss_chat_id' },
                ].map(t => (
                  <button key={t.type} className="btn btn-outline btn-sm" onClick={() => testSend(t.chat, t.type)} style={{ fontSize: '12px' }}>
                    {t.label}
                  </button>
                ))}
              </div>
              {testResult && (
                <div style={{
                  marginTop: '12px', padding: '12px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                  background: testResult.startsWith('✅') ? '#dcfce7' : testResult.startsWith('⏳') ? '#fef3c7' : '#fee2e2',
                  color: testResult.startsWith('✅') ? '#15803d' : testResult.startsWith('⏳') ? '#92400e' : '#b91c1c',
                  border: `1px solid ${testResult.startsWith('✅') ? '#86efac' : testResult.startsWith('⏳') ? '#fde68a' : '#fca5a5'}`
                }}>
                  {testResult}
                </div>
              )}
              <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '8px' }}>
                💡 กดปุ่มด้านบนเพื่อส่งข้อความตัวอย่างไปยัง Telegram (ต้องกรอก Chat ID ก่อน)
              </div>
            </div>}
          </>
        )}
      </div>

      {toast.msg && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  )
}
