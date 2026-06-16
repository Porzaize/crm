'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-client'
import { notifyTelegram } from '@/lib/notify'
import type { Customer, SmsTemplate } from '@/lib/types'

interface Props {
  customer: Customer | null
  siteId: number
  siteName?: string
  onClose: () => void
  onSave: () => void
}

function renderTemplate(body: string, ctx: Record<string, string>) {
  return body.replace(/\{\{(\w+)\}\}/g, (_, k) => ctx[k] || `{{${k}}}`)
}

export default function CustomerModal({ customer, siteId, siteName = '', onClose, onSave }: Props) {
  const supabase = createClient()
  const isNew = !customer?.id
  const [form, setForm] = useState({
    phone: '', call_date: '', call_time: '', answered: false,
    not_answered: false, sms_sent: false, total_deposit: 0, note: '',
    next_call_at: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16), do_not_call: false, do_not_call_reason: '', promo_type: '',
  })
  const [dailyDeps, setDailyDeps] = useState<number[]>(Array(31).fill(0))
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [templates, setTemplates] = useState<SmsTemplate[]>([])
  const [selectedTpl, setSelectedTpl] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    supabase.from('sms_templates').select('*').eq('active', true).order('sort_order').then(({ data }) => setTemplates(data || []))
  }, [])

  useEffect(() => {
    if (customer) {
      const nat = customer.next_call_at ? new Date(customer.next_call_at).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16) : new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16)
      setForm({
        phone: customer.phone || '',
        call_date: customer.call_date || '',
        call_time: customer.call_time || '',
        answered: customer.answered || false,
        not_answered: customer.not_answered || false,
        sms_sent: customer.sms_sent || false,
        total_deposit: parseFloat(String(customer.total_deposit || 0)),
        note: customer.note || '',
        next_call_at: nat,
        do_not_call: customer.do_not_call || false,
        do_not_call_reason: customer.do_not_call_reason || '',
        promo_type: (customer as any).promo_type || '',
      })
      loadDeposits(customer.id)
    }
  }, [customer])

  async function loadDeposits(custId: number) {
    const { data } = await supabase.from('daily_deposits').select('*').eq('customer_id', custId)
    const arr = Array(31).fill(0)
    for (const d of data || []) arr[d.day_number - 1] = parseFloat(d.deposit_amount)
    setDailyDeps(arr)
  }

  async function logAudit(action: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null, entityId: string) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('user_profiles').select('full_name').eq('id', user.id).single()
    await supabase.from('audit_logs').insert({
      user_id: user.id, user_name: profile?.full_name || user.email,
      action, entity: 'customer', entity_id: entityId,
      before_data: before, after_data: after,
    })
  }

  async function handleSave() {
    if (form.do_not_call && !form.do_not_call_reason.trim()) {
      setToast('กรุณาระบุเหตุผลที่ห้ามโทร')
      setTimeout(() => setToast(''), 3000)
      return
    }
    setSaving(true)
    try {
      const { data: { user: currentAuthUser } } = await supabase.auth.getUser()
      const nextCallAt = form.next_call_at ? new Date(form.next_call_at + ':00+07:00').toISOString() : null
      const payload: Record<string, unknown> = {
        site_id: siteId, phone: form.phone, call_date: form.call_date || null,
        call_time: form.call_time || null, answered: form.answered, not_answered: form.not_answered,
        sms_sent: form.sms_sent, total_deposit: form.total_deposit, note: form.note || null,
        next_call_at: nextCallAt,
        do_not_call: form.do_not_call,
        do_not_call_reason: form.do_not_call ? form.do_not_call_reason : null,
        promo_type: form.promo_type || null,
      }
      if (currentAuthUser && (form.answered || form.not_answered)) {
        payload.called_by = currentAuthUser.id
      }

      let custId = customer?.id
      if (isNew) {
        const { data: seqData } = await supabase.from('customers').select('seq').eq('site_id', siteId).order('seq', { ascending: false }).limit(1)
        const nextSeq = seqData && seqData.length > 0 ? (seqData[0].seq || 0) + 1 : 1
        if (form.answered || form.not_answered) payload.call_count = 1
        const { data, error } = await supabase.from('customers').insert({ ...payload, seq: nextSeq }).select().single()
        if (error) throw error
        custId = data.id
        await logAudit('customer.create', null, { phone: form.phone, site_id: siteId }, String(custId))
      } else {
        const wasNotCalled = !customer!.answered && !customer!.not_answered
        const isNowCalled = form.answered || form.not_answered
        if (wasNotCalled && isNowCalled) {
          payload.call_count = ((customer as any).call_count || 0) + 1
        } else if (isNowCalled && (form.answered !== customer!.answered || form.not_answered !== customer!.not_answered)) {
          const prev = (customer as any).call_count || 0
          if (prev === 0) payload.call_count = 1
        }
        const before = {
          phone: customer!.phone, answered: customer!.answered, not_answered: customer!.not_answered,
          total_deposit: customer!.total_deposit, do_not_call: customer!.do_not_call,
        }
        const { error } = await supabase.from('customers').update(payload).eq('id', customer!.id)
        if (error) throw error
        await supabase.from('daily_deposits').delete().eq('customer_id', customer!.id)
        const statusChanged = form.answered !== customer!.answered || form.not_answered !== customer!.not_answered
        if (statusChanged) {
          await logAudit('customer.status_change', { answered: customer!.answered, not_answered: customer!.not_answered }, { answered: form.answered, not_answered: form.not_answered }, String(customer!.id))
        }
        const depositChanged = form.total_deposit !== parseFloat(String(customer!.total_deposit || 0))
        if (depositChanged) {
          await logAudit('customer.deposit', { total_deposit: customer!.total_deposit }, { total_deposit: form.total_deposit }, String(customer!.id))
        }
        await logAudit('customer.update', before, { phone: form.phone, answered: form.answered, not_answered: form.not_answered, total_deposit: form.total_deposit, do_not_call: form.do_not_call }, String(customer!.id))
      }

      const depRows = dailyDeps.map((dep, i) => ({ customer_id: custId!, day_number: i + 1, deposit_amount: dep })).filter(r => r.deposit_amount > 0)
      if (depRows.length > 0) await supabase.from('daily_deposits').insert(depRows)

      if (form.total_deposit > 0) {
        const { data: { user: u } } = await supabase.auth.getUser()
        const { data: p } = u ? await supabase.from('user_profiles').select('full_name').eq('id', u.id).single() : { data: null }
        notifyTelegram('big_deposit', { site: siteName, phone: form.phone, deposit: form.total_deposit, by: p?.full_name || u?.email || '' })
      }
      if (form.do_not_call && (!customer || !customer.do_not_call)) {
        const { data: { user: u } } = await supabase.auth.getUser()
        const { data: p } = u ? await supabase.from('user_profiles').select('full_name').eq('id', u.id).single() : { data: null }
        notifyTelegram('dnc', { site: siteName, phone: form.phone, reason: form.do_not_call_reason, by: p?.full_name || u?.email || '' })
      }
      onSave()
      onClose()
    } catch (err: unknown) {
      setToast((err as Error).message || 'เกิดข้อผิดพลาด')
      setTimeout(() => setToast(''), 3000)
    }
    setSaving(false)
  }

  const tpl = templates.find(t => String(t.id) === selectedTpl)
  const rendered = tpl ? renderTemplate(tpl.body, { เว็บ: siteName, เบอร์: form.phone, โปร: form.promo_type || '' }) : ''

  async function handleCopy() {
    if (!rendered) return
    await navigator.clipboard.writeText(rendered)
    setForm(f => ({ ...f, sms_sent: true }))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isOverdue = form.next_call_at && new Date(form.next_call_at) < new Date()

  return (
    <div className="overlay show" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <span className="modal-title">{isNew ? '➕ เพิ่มลูกค้าใหม่' : `✏️ แก้ไข - ${form.phone}`}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {form.do_not_call && (
          <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '10px', padding: '10px 14px', marginBottom: '14px', color: '#b91c1c', fontSize: '13px', fontWeight: 600 }}>
            🚫 ลูกค้ารายนี้อยู่ในรายการห้ามโทร — {form.do_not_call_reason}
          </div>
        )}

        {form.next_call_at && !form.do_not_call && (
          <div style={{ background: isOverdue ? '#fee2e2' : '#fef3c7', border: `1px solid ${isOverdue ? '#fca5a5' : '#fcd34d'}`, borderRadius: '10px', padding: '10px 14px', marginBottom: '14px', color: isOverdue ? '#b91c1c' : '#92400e', fontSize: '13px', fontWeight: 600 }}>
            {isOverdue ? '🔴 เลยนัด: ' : '🟡 นัดโทร: '}{new Date(form.next_call_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
          <div className="form-group">
            <label>เบอร์โทร</label>
            <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="0812345678" />
          </div>
          <div className="form-group">
            <label>ยอดฝากรวม (฿)</label>
            <input type="number" value={form.total_deposit} onChange={e => setForm({ ...form, total_deposit: parseFloat(e.target.value) || 0 })} step="0.01" />
          </div>
          <div className="form-group">
            <label>วันที่โทร</label>
            <input type="date" value={form.call_date} onChange={e => setForm({ ...form, call_date: e.target.value })} />
          </div>
          <div className="form-group">
            <label>เวลาที่โทร</label>
            <input type="time" value={form.call_time} onChange={e => setForm({ ...form, call_time: e.target.value })} />
          </div>
          <div className="form-group">
            <label>นัดโทรอีกครั้ง (ไม่บังคับ)</label>
            <input type="datetime-local" value={form.next_call_at} onChange={e => setForm({ ...form, next_call_at: e.target.value })} />
          </div>
          <div className="form-group" style={{ justifyContent: 'flex-end' }}>
            {form.next_call_at && (
              <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 'auto' }} onClick={() => setForm({ ...form, next_call_at: '' })}>✕ ยกเลิกนัด</button>
            )}
          </div>
          <div className="form-group">
            <label>โปรโมชั่น</label>
            <select value={form.promo_type} onChange={e => setForm({ ...form, promo_type: e.target.value })} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 10px', borderRadius: '8px', fontSize: '13px' }}>
              <option value="">ไม่มีโปร</option>
              <option value="20%">โบนัส 20%</option>
              <option value="10%">โบนัส 10%</option>
              <option value="5%">โบนัส 5%</option>
              <option value="other">อื่นๆ</option>
            </select>
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.4px', display: 'block', marginBottom: '8px' }}>สถานะการโทร</label>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button type="button" className={`toggle-btn ${form.answered ? 'active-yes' : ''}`} onClick={() => setForm({ ...form, answered: !form.answered, not_answered: false })}>✅ รับสาย</button>
            <button type="button" className={`toggle-btn ${form.not_answered ? 'active-no' : ''}`} onClick={() => setForm({ ...form, not_answered: !form.not_answered, answered: false })}>❌ ไม่รับสาย</button>
            <button type="button" className={`toggle-btn ${form.sms_sent ? 'active-sms' : ''}`} onClick={() => setForm({ ...form, sms_sent: !form.sms_sent })}>💬 ส่ง SMS</button>
          </div>
        </div>

        {templates.length > 0 && (
          <div style={{ marginBottom: '16px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '12px', padding: '14px' }}>
            <label style={{ fontSize: '11px', color: '#0369a1', textTransform: 'uppercase', letterSpacing: '.4px', display: 'block', marginBottom: '8px', fontWeight: 700 }}>💬 คลัง SMS Template</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <select value={selectedTpl} onChange={e => setSelectedTpl(e.target.value)} style={{ flex: 1, background: '#fff', border: '1px solid #bae6fd', color: 'var(--text)', padding: '7px 10px', borderRadius: '8px', fontSize: '13px' }}>
                <option value="">-- เลือก template --</option>
                {templates.map(t => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
              </select>
              <button type="button" onClick={handleCopy} disabled={!rendered} className="btn btn-sm" style={{ background: copied ? '#059669' : '#0284c7', color: '#fff', whiteSpace: 'nowrap' }}>
                {copied ? '✓ คัดลอกแล้ว' : '📋 คัดลอก'}
              </button>
            </div>
            {rendered && (
              <div style={{ marginTop: '8px', background: '#fff', border: '1px solid #bae6fd', borderRadius: '8px', padding: '10px', fontSize: '13px', color: '#1e293b', lineHeight: 1.6 }}>
                {rendered}
              </div>
            )}
          </div>
        )}

        <div style={{ marginBottom: '16px', background: form.do_not_call ? '#fef2f2' : '#f9fafb', border: `1px solid ${form.do_not_call ? '#fca5a5' : 'var(--border)'}`, borderRadius: '12px', padding: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: form.do_not_call ? '10px' : 0 }}>
            <input type="checkbox" id="dnc" checked={form.do_not_call} onChange={e => setForm({ ...form, do_not_call: e.target.checked, do_not_call_reason: e.target.checked ? form.do_not_call_reason : '' })} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
            <label htmlFor="dnc" style={{ fontSize: '13px', fontWeight: 600, color: form.do_not_call ? '#b91c1c' : 'var(--text)', cursor: 'pointer' }}>🚫 ห้ามโทร (Do-Not-Call)</label>
          </div>
          {form.do_not_call && (
            <div className="form-group">
              <label>เหตุผล (บังคับกรอก)</label>
              <input value={form.do_not_call_reason} onChange={e => setForm({ ...form, do_not_call_reason: e.target.value })} placeholder="เช่น ลูกค้าแจ้งไม่ต้องการรับสาย" />
            </div>
          )}
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.4px', display: 'block', marginBottom: '8px' }}>ยอดฝากรายวัน (31 วัน)</label>
          <div className="day-grid">
            {dailyDeps.map((dep, i) => (
              <div key={i} className={`day-cell ${dep > 0 ? 'has-dep' : ''}`} onClick={() => {
                const val = parseFloat(prompt(`วันที่ ${i + 1} - ยอดฝาก:`, String(dep)) || String(dep))
                if (!isNaN(val)) setDailyDeps(prev => { const n = [...prev]; n[i] = val; return n })
              }}>
                <div className="day-num">วัน {i + 1}</div>
                <div className="day-dep">{dep > 0 ? `฿${dep.toLocaleString()}` : '-'}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: '16px' }}>
          <label>หมายเหตุ</label>
          <textarea value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} rows={2} placeholder="บันทึกเพิ่มเติม..." />
        </div>

        {toast && <div className="toast error" style={{ position: 'static', marginBottom: '12px' }}>{toast}</div>}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button className="btn btn-outline" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
          </button>
        </div>
      </div>
    </div>
  )
}
