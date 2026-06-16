'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { logAudit } from '@/lib/audit'
import CustomerModal from '@/components/CustomerModal'
import type { Customer } from '@/lib/types'

const PAGE_SIZE = 20

export default function SitePage({ params }: { params: { siteName: string } }) {
  const name = decodeURIComponent(params.siteName)
  const [siteId, setSiteId] = useState<number>(0)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [dateFilter, setDateFilter] = useState('')
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null)
  const [userRole, setUserRole] = useState('')
  const [siteSortBy, setSiteSortBy] = useState('')
  const [siteSortDir, setSiteSortDir] = useState<'asc' | 'desc'>('asc')
  const supabase = createClient()

  useEffect(() => { loadData(); loadRole() }, [name])

  async function loadRole() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const saved = localStorage.getItem('impersonate_role')
    const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', user.id).single()
    const real = profile?.role || user.user_metadata?.role || ''
    if (saved && (real === 'manager' || real === 'admin')) setUserRole(saved)
    else setUserRole(real)
  }

  async function loadData() {
    setLoading(true)
    const { data: site } = await supabase.from('sites').select('id').eq('name', name).single()
    if (!site) { setLoading(false); return }
    setSiteId(site.id)
    const { data } = await supabase.from('customers').select('*').eq('site_id', site.id).order('seq')
    setCustomers(data || [])
    setLoading(false)
  }

  const now = new Date()
  const todayStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })

  const filtered = customers.filter(c => {
    const phone = c.phone || ''
    if (search && !phone.includes(search.replace(/^0/, ''))) return false
    if (dateFilter && c.call_date !== dateFilter) return false
    if (filter === 'answered' && !c.answered) return false
    if (filter === 'not_answered' && !c.not_answered) return false
    if (filter === 'returned' && parseFloat(String(c.total_deposit || 0)) <= 0) return false
    if (filter === 'no_return' && parseFloat(String(c.total_deposit || 0)) > 0) return false
    if (filter === 'sms' && !c.sms_sent) return false
    if (filter === 'dnc' && !c.do_not_call) return false
    if (filter === 'callback') {
      if (!c.next_call_at) return false
      const callbackDate = new Date(c.next_call_at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
      if (callbackDate > todayStr) return false
    }
    return true
  })

  function toggleSiteSort(col: string) {
    if (siteSortBy === col) setSiteSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSiteSortBy(col); setSiteSortDir('desc') }
  }
  function siteSortIcon(col: string) { return siteSortBy === col ? (siteSortDir === 'asc' ? ' ▲' : ' ▼') : '' }

  const sorted = siteSortBy ? [...filtered].sort((a, b) => {
    let va: any, vb: any
    if (siteSortBy === 'seq') { va = a.seq || 0; vb = b.seq || 0 }
    else if (siteSortBy === 'phone') { va = a.phone || ''; vb = b.phone || '' }
    else if (siteSortBy === 'date') { va = a.call_date || ''; vb = b.call_date || '' }
    else if (siteSortBy === 'status') { va = a.answered ? 2 : a.not_answered ? 1 : 0; vb = b.answered ? 2 : b.not_answered ? 1 : 0 }
    else return 0
    if (va < vb) return siteSortDir === 'asc' ? -1 : 1
    if (va > vb) return siteSortDir === 'asc' ? 1 : -1
    return 0
  }) : filtered

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const callbackToday = customers.filter(c => {
    if (!c.next_call_at || c.do_not_call) return false
    const d = new Date(c.next_call_at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
    return d <= todayStr
  }).length

  const stats = {
    total: customers.length,
    answered: customers.filter(c => c.answered).length,
    notAns: customers.filter(c => c.not_answered).length,
    returned: customers.filter(c => parseFloat(String(c.total_deposit || 0)) > 0).length,
    deposit: customers.reduce((s, c) => s + parseFloat(String(c.total_deposit || 0)), 0),
    dnc: customers.filter(c => c.do_not_call).length,
  }

  function handleEdit(c: Customer) { setEditCustomer(c); setShowModal(true) }
  function handleAdd() { setEditCustomer(null); setShowModal(true) }

  async function downloadCSV() {
    const rows = [['#', 'เบอร์โทร', 'วันที่โทร', 'เวลา', 'รับสาย', 'ไม่รับสาย', 'SMS', 'ยอดฝาก', 'หมายเหตุ', 'ห้ามโทร']]
    for (const c of filtered) {
      rows.push([
        String(c.seq), '0' + c.phone, c.call_date || '', c.call_time || '',
        c.answered ? 'ใช่' : '', c.not_answered ? 'ใช่' : '', c.sms_sent ? 'ใช่' : '',
        String(parseFloat(String(c.total_deposit || 0)).toFixed(2)),
        c.note || '', c.do_not_call ? 'ห้ามโทร' : ''
      ])
    }
    const csv = '﻿' + rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${name}_${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
    logAudit({ action: 'report.export_csv', entity: 'Report', entityId: 'site_csv', after: { type: 'site_csv', site: name, records: filtered.length } })
  }

  const filterButtons = [
    { key: 'all', label: 'ทั้งหมด', count: customers.length },
    { key: 'answered', label: 'รับสาย', count: stats.answered },
    { key: 'not_answered', label: 'ไม่รับสาย', count: stats.notAns },
    { key: 'returned', label: 'กลับมาฝากแล้ว', count: stats.returned },
    { key: 'no_return', label: 'ยังไม่กลับมา', count: customers.length - stats.returned },
    { key: 'sms', label: '💬 ส่ง SMS', count: customers.filter(c => c.sms_sent).length },
    ...(callbackToday > 0 ? [{ key: 'callback', label: '🔔 ถึงนัดวันนี้', count: callbackToday }] : []),
    ...(stats.dnc > 0 ? [{ key: 'dnc', label: '🚫 ห้ามโทร', count: stats.dnc }] : []),
  ]

  return (
    <div>
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '13px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50, gap: '12px', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '15px', fontWeight: 600 }}>🌐 {name}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <input type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="🔍 ค้นหาเบอร์..."
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 12px', borderRadius: '8px', fontSize: '13px', width: '160px' }} />
          <input type="date" value={dateFilter} onChange={e => { setDateFilter(e.target.value); setPage(1) }}
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 10px', borderRadius: '8px', fontSize: '13px' }} />
          {dateFilter && <button onClick={() => setDateFilter('')} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', padding: '5px 10px', borderRadius: '20px', cursor: 'pointer', fontSize: '12px' }}>✕</button>}
        </div>
      </div>

      <div style={{ padding: '20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${userRole !== 'editor' ? 5 : 4},1fr)`, gap: '14px', marginBottom: '16px' }}>
          <div className="card blue"><div className="card-label">โทรทั้งหมด</div><div className="card-value">{stats.total}</div></div>
          <div className="card green"><div className="card-label">รับสาย</div><div className="card-value">{stats.answered}</div><div className="card-sub">{stats.total > 0 ? ((stats.answered / stats.total) * 100).toFixed(1) : 0}%</div></div>
          <div className="card yellow"><div className="card-label">กลับมาฝาก</div><div className="card-value">{stats.returned}</div></div>
          {userRole !== 'editor' && <div className="card red"><div className="card-label">ยอดฝากรวม</div><div className="card-value" style={{ fontSize: '20px' }}>฿{stats.deposit.toLocaleString()}</div></div>}
          <div className="card" style={{ borderTop: '3px solid #6b7280' }}>
            <div className="card-label">ห้ามโทร</div>
            <div className="card-value" style={{ color: stats.dnc > 0 ? '#dc2626' : 'var(--text)' }}>{stats.dnc}</div>
            {callbackToday > 0 && <div className="card-sub" style={{ color: '#d97706' }}>🔔 นัดวันนี้ {callbackToday} ราย</div>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
          {filterButtons.map(f => (
            <button key={f.key} className={`filter-btn ${filter === f.key ? 'active' : ''}`} onClick={() => { setFilter(f.key); setPage(1) }}>
              {f.label} <span style={{ opacity: .6 }}>({f.count})</span>
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', gap: '10px', color: 'var(--text3)' }}><div className="spinner" /> กำลังโหลด...</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSiteSort('seq')}>#{siteSortIcon('seq')}</th>
                  <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSiteSort('phone')}>เบอร์โทร{siteSortIcon('phone')}</th>
                  <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSiteSort('date')}>วันที่โทร{siteSortIcon('date')}</th>
                  <th>เวลา</th>
                  <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSiteSort('status')}>ผลสาย{siteSortIcon('status')}</th>
                  <th>รายละเอียด</th>
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: '30px', color: 'var(--text3)' }}>ไม่พบข้อมูล</td></tr>
                ) : paged.map(c => {
                  const dep = parseFloat(String(c.total_deposit || 0))
                  return (
                    <tr key={c.id} style={c.do_not_call ? { background: 'rgba(239,68,68,.04)' } : dep > 0 ? { background: 'rgba(34,197,94,.04)' } : {}}>
                      <td style={{ color: 'var(--text3)', fontSize: '12px' }}>{c.seq}</td>
                      <td>
                        <span style={{ color: 'var(--text2)', fontSize: '13px' }}>0{c.phone}</span>
                        {c.do_not_call && <span style={{ background: '#fee2e2', color: '#dc2626', fontSize: '11px', padding: '1px 6px', borderRadius: '8px', fontWeight: 700, marginLeft: '6px' }}>🚫 ห้ามโทร</span>}
                      </td>
                      <td style={{ fontSize: '12px' }}>{c.call_date || '-'}</td>
                      <td style={{ fontSize: '12px' }}>{c.call_time || '-'}</td>
                      <td>
                        {c.answered ? <span className="st st-answered"><span className="dot" />รับสาย</span>
                          : c.not_answered ? <span className="st st-notans"><span className="dot" />ไม่รับสาย</span>
                            : <span className="st" style={{ background: 'var(--surface2)', color: 'var(--text3)' }}>-</span>}
                      </td>
                      <td>
                        <button className="btn btn-outline btn-xs" onClick={() => setDetailCustomer(c)} style={{ fontSize: '12px' }}>📋 รายละเอียด</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div className="pagination">
                <span className="page-info">แสดง {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} จาก {filtered.length} รายการ</span>
                <div className="page-btns">
                  <button className="page-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>◀</button>
                  {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map(p => (
                    <button key={p} className={`page-btn ${p === page ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>
                  ))}
                  <button className="page-btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>▶</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showModal && (
        <CustomerModal
          customer={editCustomer}
          siteId={siteId}
          siteName={name}
          onClose={() => setShowModal(false)}
          onSave={() => { loadData() }}
        />
      )}

      {detailCustomer && (() => {
        const c = detailCustomer
        const dep = parseFloat(String(c.total_deposit || 0))
        const callbackDate = c.next_call_at ? new Date(c.next_call_at).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric' }) : null
        const callbackTime = c.next_call_at ? new Date(c.next_call_at).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) : null
        const items = [
          { label: 'สถานะสาย', value: c.answered ? '✅ รับสาย' : c.not_answered ? '❌ ไม่รับสาย' : '— ยังไม่ได้โทร', color: c.answered ? '#16a34a' : c.not_answered ? '#dc2626' : '#6b7280' },
          { label: 'การส่ง SMS', value: c.sms_sent ? '💬 ส่งแล้ว' : '— ยังไม่ได้ส่ง', color: c.sms_sent ? '#2563eb' : '#6b7280' },
          { label: 'ยอดฝาก', value: dep > 0 ? `฿${dep.toLocaleString('th-TH', { minimumFractionDigits: 2 })}` : '— ไม่มียอดฝาก', color: dep > 0 ? '#16a34a' : '#6b7280' },
          { label: 'นัดโทร', value: callbackDate ? `📅 ${callbackDate} เวลา ${callbackTime}` : '— ไม่มีนัด', color: callbackDate ? '#92400e' : '#6b7280' },
          { label: 'หมายเหตุ', value: c.note || '— ไม่มี', color: c.note ? '#334155' : '#6b7280' },
        ]
        return (
          <div className="overlay show" onClick={e => e.target === e.currentTarget && setDetailCustomer(null)}>
            <div className="modal" style={{ maxWidth: '420px' }}>
              <div className="modal-header">
                <span className="modal-title">📋 รายละเอียด</span>
                <button className="modal-close" onClick={() => setDetailCustomer(null)}>✕</button>
              </div>
              <div style={{ padding: '4px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', padding: '12px 16px', background: '#f1f5f9', borderRadius: '10px' }}>
                  <span style={{ fontSize: '20px' }}>📞</span>
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#1f2937' }}>0{c.phone}</div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>#{c.seq} • {c.call_date || '-'} {c.call_time || ''}</div>
                  </div>
                  {c.do_not_call && <span style={{ marginLeft: 'auto', background: '#fee2e2', color: '#dc2626', fontSize: '11px', padding: '3px 10px', borderRadius: '10px', fontWeight: 700 }}>🚫 ห้ามโทร</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {items.map(item => (
                    <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', background: '#fafafa', borderRadius: '8px', border: '1px solid #f0f0f0' }}>
                      <span style={{ fontSize: '13px', color: '#6b7280', fontWeight: 600 }}>{item.label}</span>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: item.color }}>{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
