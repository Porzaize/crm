'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import type { SmsTemplate } from '@/lib/types'

const VARS = ['{{เว็บ}}', '{{เบอร์}}', '{{โปร}}']

export default function SmsTemplatesPage() {
  const [templates, setTemplates] = useState<SmsTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editTpl, setEditTpl] = useState<SmsTemplate | null>(null)
  const [form, setForm] = useState({ name: '', body: '', active: true, sort_order: 0 })
  const [preview, setPreview] = useState({ เว็บ: 'มรกต', เบอร์: '0812345678', โปร: '20%' })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState({ msg: '', type: '' })
  const [sendPhone, setSendPhone] = useState('')
  const [sendMsg, setSendMsg] = useState('')
  const [sending, setSending] = useState(false)
  const [copied, setCopied] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [authorized, setAuthorized] = useState(false)
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string }>({ id: '', name: '' })
  const [smsLogs, setSmsLogs] = useState<any[]>([])
  const [logLoading, setLogLoading] = useState(false)
  const [filterFrom, setFilterFrom] = useState(() => { const d = new Date(); d.setDate(1); return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }) })
  const [filterTo, setFilterTo] = useState(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }))
  const [filterUser, setFilterUser] = useState('')
  const [filterPhone, setFilterPhone] = useState('')
  const [users, setUsers] = useState<{ id: string; full_name: string }[]>([])
  const [userRole, setUserRole] = useState('')
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { setAuthChecked(true); return }
      const metaRole = user.user_metadata?.role || ''
      const metaName = user.user_metadata?.full_name || user.email || ''
      supabase.from('user_profiles').select('role, full_name').eq('id', user.id).single().then(({ data: profile }) => {
        const role = profile?.role || metaRole || ''
        const name = profile?.full_name || metaName
        if (role === 'admin' || role === 'manager') setAuthorized(true)
        const saved = localStorage.getItem('impersonate_role')
        if (saved && (role === 'manager' || role === 'admin')) setUserRole(saved)
        else setUserRole(role)
        setCurrentUser({ id: user.id, name })
        setAuthChecked(true)
      })
    })
    fetch('/api/users').then(r => r.json()).then(d => setUsers(d.users || [])).catch(() => {})
    load()
    loadLogs()
  }, [])
  async function load() {
    setLoading(true)
    const { data } = await supabase.from('sms_templates').select('*').order('sort_order').order('id')
    setTemplates(data || [])
    setLoading(false)
  }

  async function loadLogs(fromDate?: string, toDate?: string, userName?: string, phone?: string) {
    setLogLoading(true)
    let q = supabase.from('sms_logs').select('*').order('created_at', { ascending: false }).limit(50)
    if (fromDate) q = q.gte('created_at', fromDate + 'T00:00:00')
    if (toDate) q = q.lte('created_at', toDate + 'T23:59:59')
    if (userName) q = q.eq('user_name', userName)
    if (phone) q = q.ilike('phone', `%${phone}%`)
    const { data } = await q
    setSmsLogs(data || [])
    setLogLoading(false)
  }

  function render(body: string) {
    return body.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (preview as Record<string, string>)[k] || `{{${k}}}`)
  }

  function openAdd() { setEditTpl(null); setForm({ name: '', body: '', active: true, sort_order: templates.length }); setShowModal(true) }
  function openEdit(t: SmsTemplate) { setEditTpl(t); setForm({ name: t.name, body: t.body, active: t.active, sort_order: t.sort_order }); setShowModal(true) }

  async function handleSave() {
    if (!form.name.trim() || !form.body.trim()) { setToast({ msg: 'กรุณากรอกชื่อและเนื้อความ', type: 'error' }); setTimeout(() => setToast({ msg: '', type: '' }), 3000); return }
    setSaving(true)
    if (editTpl) {
      await supabase.from('sms_templates').update(form).eq('id', editTpl.id)
    } else {
      await supabase.from('sms_templates').insert(form)
    }
    setSaving(false)
    setShowModal(false)
    setToast({ msg: 'บันทึกสำเร็จ', type: 'success' })
    setTimeout(() => setToast({ msg: '', type: '' }), 2000)
    load()
  }

  async function toggleActive(t: SmsTemplate) {
    await supabase.from('sms_templates').update({ active: !t.active }).eq('id', t.id)
    load()
  }

  async function handleDelete(t: SmsTemplate) {
    if (!confirm(`ลบ template "${t.name}"?`)) return
    await supabase.from('sms_templates').delete().eq('id', t.id)
    load()
  }

  if (!authChecked) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '10px', color: 'var(--text3)' }}>
        <div className="spinner" /> กำลังโหลด...
      </div>
    )
  }

  if (!authorized) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--text3)', fontSize: '14px' }}>
        เฉพาะ Admin / Manager เท่านั้น
      </div>
    )
  }

  return (
    <div>
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '13px 24px', position: 'sticky', top: 0, zIndex: 50 }}>
        <h2 style={{ fontSize: '15px', fontWeight: 600 }}>💬 ส่งข้อความแจ้งเตือนทาง SMS</h2>
      </div>

      <div style={{ padding: '20px' }}>
        {userRole !== 'viewer' ? <div className="card" style={{ width: '100%', padding: 0, overflow: 'hidden' }}>
          <div style={{ background: '#f1f5f9', borderBottom: '1px solid var(--border)', padding: '12px 20px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>📨 ส่งข้อความ SMS</h3>
          </div>
          <div style={{ padding: '24px 20px' }}>

          <div className="form-group" style={{ marginBottom: '18px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>📞 เบอร์โทรศัพท์</label>
            <input
              type="tel"
              value={sendPhone}
              onChange={e => setSendPhone(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="0812345678"
              maxLength={10}
              style={{ fontSize: '14px', padding: '10px 12px' }}
            />
          </div>

          <div className="form-group" style={{ marginBottom: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>💬 ข้อความ</label>
            <textarea
              value={sendMsg}
              onChange={e => { if (e.target.value.length <= 100) setSendMsg(e.target.value) }}
              rows={4}
              placeholder="พิมพ์ข้อความที่ต้องการส่ง..."
              style={{ fontSize: '14px', resize: 'none', padding: '10px 12px' }}
            />
          </div>
          <div style={{ textAlign: 'right', fontSize: '12px', color: sendMsg.length >= 100 ? 'var(--red)' : 'var(--text3)', marginBottom: '20px', fontWeight: 600 }}>
            {sendMsg.length} / 100
          </div>

          <button
            className="btn btn-success"
            onClick={async () => {
              if (!sendPhone.trim() || !sendMsg.trim()) {
                setToast({ msg: 'กรุณากรอกเบอร์โทรและข้อความ', type: 'error' })
                setTimeout(() => setToast({ msg: '', type: '' }), 3000)
                return
              }
              try {
                await navigator.clipboard.writeText(sendMsg)
                try {
                  await supabase.from('sms_logs').insert({
                    phone: sendPhone, message: sendMsg, send_type: 'SMS',
                    status: 'สำเร็จ', user_id: currentUser.id || null, user_name: currentUser.name,
                  })
                  loadLogs()
                } catch {}
                setCopied(true)
                setToast({ msg: `คัดลอกข้อความสำเร็จ — พร้อมส่งไปยัง ${sendPhone}`, type: 'success' })
                setTimeout(() => { setToast({ msg: '', type: '' }); setCopied(false) }, 3000)
              } catch {
                setToast({ msg: 'ไม่สามารถคัดลอกได้', type: 'error' })
                setTimeout(() => setToast({ msg: '', type: '' }), 3000)
              }
            }}
            disabled={sending}
          >
            {copied ? '✅ คัดลอกแล้ว' : 'ส่งข้อความ'}
          </button>
          </div>
        </div> : (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px', marginBottom: '20px', textAlign: 'center', color: 'var(--text3)' }}>🔒 Viewer ไม่สามารถส่ง SMS ได้</div>
        )}

        {/* ประวัติการส่ง SMS */}
        <div className="card" style={{ width: '100%', padding: 0, overflow: 'hidden', marginTop: '20px' }}>
          <div style={{ background: '#f1f5f9', borderBottom: '1px solid var(--border)', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>📋 ประวัติการส่ง SMS</h3>
            {smsLogs.length > 0 && userRole !== 'viewer' && (
              <button className="btn-export" onClick={() => {
                const rows = smsLogs.map(l => [
                  l.phone,
                  l.status,
                  l.message,
                  l.user_name || '-',
                  new Date(l.created_at).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
                ])
                const header = ['เบอร์โทรศัพท์', 'สถานะ', 'ข้อความ', 'ผู้ส่ง', 'วันที่ส่ง']
                const csv = '﻿' + [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a'); a.href = url; a.download = `SMS_History_${new Date().toISOString().slice(0,10)}.csv`; a.click()
                URL.revokeObjectURL(url)
              }}>
                📥 ออกรายงาน
              </button>
            )}
          </div>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', alignItems: 'end' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>📅 จากวันที่</label>
                <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={{ fontSize: '13px' }} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>📅 ถึงวันที่</label>
                <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} style={{ fontSize: '13px' }} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>ชื่อผู้ส่ง</label>
                <select value={filterUser} onChange={e => setFilterUser(e.target.value)} style={{ fontSize: '13px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 10px', borderRadius: '8px' }}>
                  <option value="">ทั้งหมด</option>
                  {users.map(u => <option key={u.id} value={u.full_name}>{u.full_name}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>เบอร์โทรศัพท์</label>
                <input value={filterPhone} onChange={e => setFilterPhone(e.target.value)} placeholder="ค้นหาเบอร์..." style={{ fontSize: '13px' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button className="btn btn-success" onClick={() => loadLogs(filterFrom, filterTo, filterUser, filterPhone)}>🔍 ค้นหา</button>
              <button className="btn btn-outline" onClick={() => { setFilterFrom(''); setFilterTo(''); setFilterUser(''); setFilterPhone(''); loadLogs() }}>ล้าง</button>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid var(--border)' }}>
                  <th style={{ padding: '10px 18px', textAlign: 'left', fontWeight: 700, color: 'var(--text2)', whiteSpace: 'nowrap' }}>เบอร์โทรศัพท์</th>
                  <th style={{ padding: '10px 18px', textAlign: 'left', fontWeight: 700, color: 'var(--text2)' }}>สถานะ</th>
                  <th style={{ padding: '10px 18px', textAlign: 'left', fontWeight: 700, color: 'var(--text2)' }}>ข้อความ</th>
                  <th style={{ padding: '10px 18px', textAlign: 'left', fontWeight: 700, color: 'var(--text2)' }}>ผู้ส่ง</th>
                  <th style={{ padding: '10px 18px', textAlign: 'left', fontWeight: 700, color: 'var(--text2)', whiteSpace: 'nowrap' }}>วันที่ส่ง</th>
                </tr>
              </thead>
              <tbody>
                {logLoading ? (
                  <tr><td colSpan={5} style={{ padding: '30px', textAlign: 'center', color: 'var(--text3)' }}><div className="spinner" style={{ display: 'inline-block', marginRight: '8px' }} />กำลังโหลด...</td></tr>
                ) : smsLogs.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: '30px', textAlign: 'center', color: 'var(--text3)' }}>ยังไม่มีประวัติการส่ง SMS</td></tr>
                ) : smsLogs.map(log => (
                  <tr key={log.id} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => alert(log.message)} title="คลิกเพื่อดูข้อความเต็ม">
                    <td style={{ padding: '10px 18px', fontWeight: 600 }}>{log.phone}</td>
                    <td style={{ padding: '10px 18px' }}>{log.status}</td>
                    <td style={{ padding: '10px 18px', maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text2)' }}>{log.message}</td>
                    <td style={{ padding: '10px 18px', whiteSpace: 'nowrap' }}>{log.user_name || '-'}</td>
                    <td style={{ padding: '10px 18px', whiteSpace: 'nowrap' }}>{new Date(log.created_at).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="overlay show" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">{editTpl ? '✏️ แก้ไข Template' : '➕ เพิ่ม Template ใหม่'}</span>
              <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="form-group">
                <label>ชื่อ Template</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="เช่น ทวงรัก + โปร 20%" />
              </div>
              <div className="form-group">
                <label>เนื้อความ (ใช้ {VARS.join(', ')} เพื่อแทรกตัวแปร)</label>
                <textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} rows={4} placeholder="สวัสดีค่ะ ลูกค้า {{เว็บ}} รับโบนัส {{โปร}} วันนี้นะคะ" />
              </div>
              {form.body && (
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text3)', display: 'block', marginBottom: '6px' }}>ตัวอย่างผลลัพธ์</label>
                  <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '10px', fontSize: '13px', lineHeight: 1.6 }}>
                    {render(form.body)}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                    {Object.entries(preview).map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text3)' }}>{`{{${k}}}`}:</span>
                        <input value={v} onChange={e => setPreview(p => ({ ...p, [k]: e.target.value }))} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '3px 8px', borderRadius: '6px', fontSize: '12px', width: '100px' }} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" id="active" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
                <label htmlFor="active" style={{ fontSize: '13px' }}>เปิดใช้งาน</label>
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button className="btn btn-outline" onClick={() => setShowModal(false)}>ยกเลิก</button>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'กำลังบันทึก...' : '💾 บันทึก'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast.msg && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  )
}
