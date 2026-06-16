'use client'
import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase-client'
import type { AuditLog } from '@/lib/types'

const ACTION_LABELS: Record<string, string> = {
  'customer.create': 'เพิ่มลูกค้า',
  'customer.update': 'แก้ไขลูกค้า',
  'customer.delete': 'ลบลูกค้า',
  'customer.call_log': 'บันทึกการโทร',
  'customer.deposit': 'บันทึกการฝาก',
  'customer.status_change': 'เปลี่ยนสถานะ',
  'customer.sms': 'ส่ง SMS',
  'customer.import': 'นำเข้าข้อมูล',
  'user.create': 'สร้างผู้ใช้',
  'user.update': 'แก้ไขผู้ใช้',
  'user.delete': 'ลบผู้ใช้',
  'user.reset_password': 'รีเซ็ตรหัสผ่าน',
  'bonus.create': 'เพิ่มโบนัส',
  'bonus.update': 'แก้ไขโบนัส',
  'report.export': 'ออกรายงาน',
  'report.export_csv': 'ดาวน์โหลด CSV',
  'report.export_cohort': 'ออกรายงาน Cohort',
  'report.export_agents': 'ออกรายงานพนักงาน',
  'auth.login': 'เข้าสู่ระบบสำเร็จ',
  'auth.login_failed': 'เข้าสู่ระบบล้มเหลว',
  'auth.logout': 'ออกจากระบบ',
}

const CATEGORIES = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'bonus', label: 'การปรับโบนัส', actions: ['bonus.create', 'bonus.update'] },
  { key: 'customer_edit', label: 'การแก้ไขข้อมูลลูกค้า', actions: ['customer.update', 'customer.call_log', 'customer.deposit', 'customer.status_change', 'customer.create', 'customer.delete'] },
  { key: 'user_manage', label: 'สร้าง/ปิดใช้งานผู้ใช้', actions: ['user.create', 'user.update', 'user.delete'] },
  { key: 'reset_pwd', label: 'รีเซ็ตรหัสผ่าน', actions: ['user.reset_password'] },
  { key: 'report', label: 'ออกรายงาน', actions: ['report.export', 'report.export_csv', 'report.export_cohort', 'report.export_agents'] },
  { key: 'sms', label: 'ส่ง SMS', actions: ['customer.sms'] },
  { key: 'import', label: 'นำเข้าข้อมูล', actions: ['customer.import'] },
  { key: 'auth', label: 'เข้า/ออกจากระบบ', actions: ['auth.login', 'auth.login_failed', 'auth.logout'] },
]

const FIELD_LABELS: Record<string, string> = {
  phone: 'เบอร์โทร', site_id: 'เว็บ', call_date: 'วันที่โทร', call_time: 'เวลาโทร',
  answered: 'รับสาย', not_answered: 'ไม่รับสาย', sms_sent: 'ส่ง SMS', total_deposit: 'ยอดฝาก',
  note: 'หมายเหตุ', do_not_call: 'ห้ามโทร', do_not_call_reason: 'เหตุผลห้ามโทร',
  promo_type: 'โปรโมชั่น', call_count: 'จำนวนครั้งที่โทร', next_call_at: 'นัดโทร',
  full_name: 'ชื่อ', role: 'บทบาท', email: 'อีเมล', is_active: 'เปิดใช้งาน',
  site_access: 'เข้าถึงเว็บ', type: 'ประเภท', dateFrom: 'จากวันที่', dateTo: 'ถึงวันที่',
  site: 'เว็บ', action: 'การกระทำ', records: 'จำนวน',
}

function formatValue(key: string, val: unknown): string {
  if (val === null || val === undefined) return '-'
  if (typeof val === 'boolean') return val ? 'ใช่' : 'ไม่ใช่'
  if (key === 'total_deposit' && typeof val === 'number') return `฿${val.toLocaleString()}`
  return String(val)
}

const inputStyle: React.CSSProperties = { background: '#fff', border: '1px solid #d1d5db', color: '#1e293b', padding: '8px 12px', borderRadius: '8px', fontSize: '13px', width: '100%' }

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [recentLogs, setRecentLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [searched, setSearched] = useState(false)
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(1); return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }) })
  const [dateTo, setDateTo] = useState(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }))
  const [category, setCategory] = useState('')
  const [searchUser, setSearchUser] = useState('')
  const [searchActor, setSearchActor] = useState('')
  const [userList, setUserList] = useState<{ id: string; name: string; email: string }[]>([])
  const [appliedFilters, setAppliedFilters] = useState({ dateFrom: '', dateTo: '', category: '', searchUser: '', searchActor: '' })
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  const [page, setPage] = useState(1)
  const [userRole, setUserRole] = useState('')
  const PAGE_SIZE = 50
  const supabase = createClient()

  useEffect(() => { checkAuth() }, [])

  async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setAuthorized(false); return }
    const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', user.id).single()
    const role = profile?.role || user.user_metadata?.role || ''
    const saved = localStorage.getItem('impersonate_role')
    const effectiveRole = (saved && (role === 'manager' || role === 'admin')) ? saved : role
    setUserRole(effectiveRole)
    const ok = effectiveRole === 'admin' || effectiveRole === 'manager' || effectiveRole === 'viewer'
    setAuthorized(ok)
    if (ok) {
      loadUsers()
      loadRecent()
    }
  }

  async function loadUsers() {
    const res = await fetch('/api/users')
    const data = await res.json()
    setUserList((data.users || []).map((u: any) => ({ id: u.id, name: u.full_name || '', email: u.email || '' })))
  }

  async function loadRecent() {
    setLoading(true)
    const { data } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(20)
    setRecentLogs(data || [])
    setLoading(false)
  }

  async function handleSearch() {
    setLoading(true)
    setSearched(true)
    setAppliedFilters({ dateFrom, dateTo, category, searchUser, searchActor })
    let q = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(500)
    if (dateFrom) q = q.gte('created_at', dateFrom + 'T00:00:00+07:00')
    if (dateTo) q = q.lte('created_at', dateTo + 'T23:59:59+07:00')
    const { data } = await q
    setLogs(data || [])
    setPage(1)
    setLoading(false)
  }

  const filtered = useMemo(() => {
    let result = logs
    const cat = CATEGORIES.find(c => c.key === appliedFilters.category)
    if (cat?.actions) result = result.filter(l => cat.actions!.includes(l.action))
    if (appliedFilters.searchActor) {
      result = result.filter(l => (l.user_name || '') === appliedFilters.searchActor)
    }
    if (appliedFilters.searchUser) {
      const s = appliedFilters.searchUser.toLowerCase()
      result = result.filter(l => {
        const afterName = l.after_data ? String(l.after_data.full_name || l.after_data.phone || l.after_data.email || '').toLowerCase() : ''
        const beforeName = l.before_data ? String(l.before_data.full_name || l.before_data.phone || l.before_data.email || '').toLowerCase() : ''
        return (l.user_name || '').toLowerCase() === s || afterName.includes(s) || beforeName.includes(s)
      })
    }
    return result
  }, [logs, appliedFilters])

  const activeList = searched ? filtered : recentLogs
  const paged = activeList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.ceil(activeList.length / PAGE_SIZE)
  const displayRows = paged

  function diffLabel(before: Record<string, unknown> | null, after: Record<string, unknown> | null, action: string) {
    if (!before && after) {
      const keys = Object.keys(after).filter(k => after[k] !== null && after[k] !== undefined)
      return (
        <div style={{ fontSize: '12px' }}>
          <span style={{ color: 'var(--green)', fontWeight: 600 }}>สร้างใหม่</span>
          {keys.length > 0 && (
            <div style={{ marginTop: '3px', color: 'var(--text2)', lineHeight: 1.6 }}>
              {keys.slice(0, 5).map(k => (
                <span key={k} style={{ display: 'inline-block', marginRight: '8px', background: 'rgba(34,197,94,.08)', padding: '1px 6px', borderRadius: '4px' }}>
                  {FIELD_LABELS[k] || k}: <b>{formatValue(k, after[k])}</b>
                </span>
              ))}
            </div>
          )}
        </div>
      )
    }
    if (!after) return <span style={{ color: 'var(--red)', fontSize: '12px', fontWeight: 600 }}>ลบแล้ว</span>
    if (action.startsWith('report.')) {
      return (
        <div style={{ fontSize: '12px', color: 'var(--text2)', lineHeight: 1.6 }}>
          {Object.keys(after).map(k => (
            <span key={k} style={{ display: 'inline-block', marginRight: '8px' }}>
              {FIELD_LABELS[k] || k}: <b>{formatValue(k, after[k])}</b>
            </span>
          ))}
        </div>
      )
    }
    const changedKeys = Object.keys(after).filter(k => {
      return String(before?.[k] ?? '') !== String(after[k] ?? '')
    })
    if (changedKeys.length === 0) return <span style={{ fontSize: '12px', color: 'var(--text3)' }}>ไม่มีการเปลี่ยนแปลง</span>
    return (
      <div style={{ fontSize: '12px', color: 'var(--text2)', lineHeight: 1.8 }}>
        {changedKeys.map(k => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>{FIELD_LABELS[k] || k}:</span>
            <span style={{ background: 'rgba(239,68,68,.08)', padding: '1px 6px', borderRadius: '4px', textDecoration: 'line-through', color: '#b91c1c' }}>{formatValue(k, before?.[k])}</span>
            <span style={{ color: 'var(--text3)' }}>→</span>
            <span style={{ background: 'rgba(34,197,94,.08)', padding: '1px 6px', borderRadius: '4px', color: '#16a34a', fontWeight: 600 }}>{formatValue(k, after[k])}</span>
          </div>
        ))}
      </div>
    )
  }

  function actionBadgeColor(action: string) {
    if (action === 'auth.login_failed') return { bg: 'rgba(239,68,68,.1)', color: '#dc2626' }
    if (action === 'auth.login') return { bg: 'rgba(34,197,94,.1)', color: '#16a34a' }
    if (action.startsWith('report.')) return { bg: 'rgba(34,197,94,.1)', color: '#16a34a' }
    if (action.startsWith('user.')) return { bg: 'rgba(234,88,12,.1)', color: '#ea580c' }
    if (action.startsWith('bonus.')) return { bg: 'rgba(168,85,247,.1)', color: '#9333ea' }
    if (action === 'customer.delete') return { bg: 'rgba(239,68,68,.1)', color: '#dc2626' }
    if (action === 'customer.status_change') return { bg: 'rgba(59,130,246,.1)', color: '#2563eb' }
    if (action === 'customer.deposit') return { bg: 'rgba(245,158,11,.1)', color: '#d97706' }
    return { bg: 'rgba(108,99,255,.12)', color: 'var(--accent)' }
  }

  if (authorized === null) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', gap: '10px', color: 'var(--text3)' }}><div className="spinner" /> กำลังตรวจสอบสิทธิ์...</div>
  if (authorized === false) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '300px', gap: '12px', color: 'var(--text3)' }}>
      <span style={{ fontSize: '40px' }}>🔒</span>
      <h3 style={{ fontSize: '16px', color: 'var(--text)' }}>ไม่มีสิทธิ์เข้าถึง</h3>
      <p style={{ fontSize: '13px' }}>หน้านี้สำหรับ Admin / Manager เท่านั้น</p>
    </div>
  )

  return (
    <div>
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '13px 24px', position: 'sticky', top: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: '15px', fontWeight: 600 }}>📋 Audit Log — ประวัติการเปลี่ยนแปลง</h2>
        {activeList.length > 0 && userRole !== 'viewer' && (
          <button className="btn-export" onClick={() => {
            const rows = activeList.map(l => {
              const catMatch = CATEGORIES.find(c => c.actions?.includes(l.action))
              return [
                new Date(l.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
                l.user_name || '-',
                catMatch?.label || '-',
                ACTION_LABELS[l.action] || l.action,
                `${l.entity} #${l.entity_id}`,
                l.after_data ? JSON.stringify(l.after_data) : '-',
              ]
            })
            const header = ['เวลา', 'ผู้ทำ', 'ประเภท', 'การกระทำ', 'รายการ', 'รายละเอียด']
            const csv = '﻿' + [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a'); a.href = url; a.download = `Audit_Log_${new Date().toISOString().slice(0,10)}.csv`; a.click()
            URL.revokeObjectURL(url)
          }}>
            📥 ออกรายงาน
          </button>
        )}
      </div>

      {/* ─── Filters ─── */}
      <div style={{ padding: '20px 24px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={{ fontSize: '12px', color: 'var(--text2)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>📅 วันที่เริ่ม</label>
            <div style={{ position: 'relative' }}>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle} />
              {dateFrom && (
                <button onClick={() => setDateFrom('')} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: '#9ca3af', color: '#fff', border: 'none', borderRadius: '50%', width: '18px', height: '18px', fontSize: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>✕</button>
              )}
            </div>
          </div>
          <div>
            <label style={{ fontSize: '12px', color: 'var(--text2)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>📅 วันที่สิ้นสุด</label>
            <div style={{ position: 'relative' }}>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle} />
              {dateTo && (
                <button onClick={() => setDateTo('')} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: '#9ca3af', color: '#fff', border: 'none', borderRadius: '50%', width: '18px', height: '18px', fontSize: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>✕</button>
              )}
            </div>
          </div>
          <div>
            <label style={{ fontSize: '12px', color: 'var(--text2)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>ชื่อผู้ใช้</label>
            <select value={searchUser} onChange={e => setSearchUser(e.target.value)} style={inputStyle}>
              <option value="">ทุกคน</option>
              {userList.map(u => <option key={u.id} value={u.name || u.email}>{u.name || u.email}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '14px', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: '12px', color: 'var(--text2)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>ประเภท</label>
            <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...inputStyle, minWidth: '220px' }}>
              {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <button className="btn btn-success" onClick={handleSearch}>
            🔍 ค้นหา
          </button>
          {(dateFrom || dateTo || category || searchUser || searched) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); setCategory(''); setSearchUser(''); setSearchActor(''); setSearched(false); setPage(1) }} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit' }}>
              ล้างทั้งหมด
            </button>
          )}
          <div style={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--text3)', paddingBottom: '6px' }}>
            {searched ? <>พบ <b style={{ color: 'var(--text)', fontSize: '15px' }}>{filtered.length}</b> รายการ</> : <>ล่าสุด <b style={{ color: 'var(--text)', fontSize: '15px' }}>{recentLogs.length}</b> รายการ</>}
          </div>
        </div>
      </div>

      {/* ─── Table ─── */}
      <div style={{ padding: '20px' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', gap: '10px', color: 'var(--text3)' }}><div className="spinner" /> กำลังโหลด...</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>เวลา</th><th>ผู้ทำ</th><th>ประเภท</th><th>การกระทำ</th><th>รายละเอียด</th></tr>
              </thead>
              <tbody>
                {displayRows.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: 'var(--text3)' }}>
                    <div style={{ fontSize: '28px', marginBottom: '8px' }}>📋</div>
                    ไม่พบ log {searched ? '— ลองเปลี่ยนเงื่อนไขค้นหา' : ''}
                  </td></tr>
                ) : displayRows.map(l => {
                  const badge = actionBadgeColor(l.action)
                  const catMatch = CATEGORIES.find(c => c.actions?.includes(l.action))
                  const isExpanded = expandedRows.has(l.id)
                  return (
                    <tr key={l.id} onClick={() => setExpandedRows(prev => { const next = new Set(prev); if (next.has(l.id)) next.delete(l.id); else next.add(l.id); return next })} style={{ cursor: 'pointer' }}>
                      <td style={{ fontSize: '13px', color: 'var(--text2)', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                        <div>{new Date(l.created_at).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: '2-digit' })}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text3)' }}>{new Date(l.created_at).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })}</div>
                      </td>
                      <td style={{ fontSize: '13px', fontWeight: 600, verticalAlign: 'top' }}>{l.user_name || '-'}</td>
                      <td style={{ fontSize: '13px', color: 'var(--text2)', verticalAlign: 'top' }}>{catMatch?.label || '-'}</td>
                      <td style={{ verticalAlign: 'top' }}><span style={{ background: badge.bg, color: badge.color, fontSize: '11px', padding: '2px 8px', borderRadius: '10px', fontWeight: 700, whiteSpace: 'nowrap' }}>{ACTION_LABELS[l.action] || l.action}</span></td>
                      <td style={{ verticalAlign: 'top' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--accent)', fontWeight: 600 }}>
                          <span style={{ transition: 'transform .15s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', fontSize: '10px' }}>▶</span>
                          ดูรายละเอียด
                        </div>
                        {isExpanded && (
                          <div style={{ marginTop: '8px', padding: '10px 14px', background: 'var(--surface2)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                            <div style={{ fontSize: '12px', color: 'var(--text2)', marginBottom: '8px' }}>
                              <span style={{ fontWeight: 600, color: 'var(--text)' }}>รายการ:</span> {l.entity} #{l.entity_id}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text2)' }}>
                              <span style={{ fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: '4px' }}>การเปลี่ยนแปลง:</span>
                              {diffLabel(l.before_data, l.after_data, l.action)}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div className="pagination">
                <span className="page-info">แสดง {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, activeList.length)} จาก {activeList.length} รายการ</span>
                <div className="page-btns">
                  <button className="page-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>◀</button>
                  {Array.from({ length: Math.min(totalPages, 8) }, (_, i) => i + 1).map(p => (
                    <button key={p} className={`page-btn ${p === page ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>
                  ))}
                  <button className="page-btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>▶</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
