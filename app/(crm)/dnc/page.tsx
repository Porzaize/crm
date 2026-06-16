'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { logAudit } from '@/lib/audit'
import type { Customer, Site } from '@/lib/types'

function fmt(d: Date) { return d.toISOString().split('T')[0] }

export default function DncPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [sites, setSites] = useState<Site[]>([])
  const [dncList, setDncList] = useState<(Customer & { siteName: string })[]>([])
  const [siteFilter, setSiteFilter] = useState('')
  const [phoneSearch, setPhoneSearch] = useState('')
  const [exporting, setExporting] = useState(false)
  const [userRole, setUserRole] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkUnlocking, setBulkUnlocking] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => { loadRole(); loadData() }, [])

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
    const { data: siteList } = await supabase.from('sites').select('*').order('id')
    setSites(siteList || [])
    const { data } = await supabase.from('customers').select('*, sites(name)')
      .eq('do_not_call', true).order('site_id').order('seq')
    setDncList((data || []).map(c => ({ ...c, siteName: c.sites?.name || '' })))
    setSelectedIds(new Set())
    setLoading(false)
  }

  /* ---------- filtered list ---------- */
  function getFiltered() {
    let list = dncList
    if (siteFilter) list = list.filter(c => c.siteName === siteFilter)
    if (phoneSearch) {
      const s = phoneSearch.replace(/\D/g, '')
      list = list.filter(c => {
        const p = String(c.phone || '')
        return p.includes(s) || ('0' + p).includes(s)
      })
    }
    return list
  }

  /* ---------- site breakdown ---------- */
  function getSiteBreakdown() {
    const map = new Map<string, number>()
    dncList.forEach(c => {
      const name = c.siteName || 'ไม่ระบุ'
      map.set(name, (map.get(name) || 0) + 1)
    })
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }

  /* ---------- unlock single ---------- */
  async function unlockDnc(c: Customer & { siteName: string }) {
    if (!confirm(`ปลดล็อคเบอร์ 0${c.phone} จาก DNC?`)) return
    const { error } = await supabase.from('customers').update({
      do_not_call: false,
      do_not_call_reason: null,
    }).eq('id', c.id)
    if (error) { showToast('เกิดข้อผิดพลาด'); return }
    logAudit({
      action: 'dnc.unlock',
      entity: 'Customer',
      entityId: String(c.id),
      after: { phone: c.phone, site: c.siteName },
    })
    showToast(`ปลดล็อค 0${c.phone} สำเร็จ`)
    loadData()
  }

  /* ---------- bulk unlock ---------- */
  async function bulkUnlock() {
    if (selectedIds.size === 0) return
    if (!confirm(`ปลดล็อค ${selectedIds.size} เบอร์ จาก DNC?`)) return
    setBulkUnlocking(true)
    const ids = Array.from(selectedIds)
    const { error } = await supabase.from('customers').update({
      do_not_call: false,
      do_not_call_reason: null,
    }).in('id', ids)
    if (error) { showToast('เกิดข้อผิดพลาด'); setBulkUnlocking(false); return }
    logAudit({
      action: 'dnc.bulk_unlock',
      entity: 'Customer',
      entityId: ids.join(','),
      after: { count: ids.length },
    })
    showToast(`ปลดล็อค ${ids.length} เบอร์สำเร็จ`)
    setBulkUnlocking(false)
    loadData()
  }

  /* ---------- export ---------- */
  async function exportDnc() {
    setExporting(true)
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'do_not_call', site: siteFilter || undefined }),
    })
    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ห้ามโทร_${fmt(new Date())}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      logAudit({
        action: 'report.export',
        entity: 'Report',
        entityId: 'do_not_call',
        after: { type: 'do_not_call', site: siteFilter || 'ทุกเว็บ' },
      })
    }
    setExporting(false)
  }

  /* ---------- helpers ---------- */
  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll(filtered: (Customer & { siteName: string })[]) {
    if (filtered.every(c => selectedIds.has(c.id))) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        filtered.forEach(c => next.delete(c.id))
        return next
      })
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev)
        filtered.forEach(c => next.add(c.id))
        return next
      })
    }
  }

  const canAct = userRole !== 'viewer'
  const canExport = userRole !== 'viewer' && userRole !== 'editor'
  const filtered = getFiltered()
  const breakdown = getSiteBreakdown()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* ===== Topbar ===== */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 30,
        background: '#fff', borderBottom: '1px solid var(--border)',
        padding: '18px 24px',
      }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>
          🚫 รายการห้ามโทร (DNC)
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text3)' }}>
          จัดการเบอร์โทรศัพท์ที่ถูกตั้งค่าห้ามโทร
        </p>
      </div>

      <div style={{ padding: '20px 24px', maxWidth: '1200px', margin: '0 auto' }}>
        {/* ===== Loading ===== */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text3)' }}>
            <div className="spinner" />
            <div style={{ marginTop: '12px' }}>กำลังโหลด...</div>
          </div>
        ) : (
          <>
            {/* ===== Summary Cards ===== */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '12px',
              marginBottom: '20px',
            }}>
              {/* Total card */}
              <div style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                boxShadow: '0 1px 3px rgba(0,0,0,.06)',
                padding: '16px',
              }}>
                <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '4px' }}>เบอร์ DNC ทั้งหมด</div>
                <div style={{ fontSize: '28px', fontWeight: 800, color: '#dc2626' }}>{dncList.length}</div>
              </div>

              {/* Per-site cards */}
              {breakdown.map(([name, count]) => (
                <div key={name} style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  boxShadow: '0 1px 3px rgba(0,0,0,.06)',
                  padding: '16px',
                  cursor: 'pointer',
                  outline: siteFilter === name ? '2px solid var(--accent)' : 'none',
                }} onClick={() => setSiteFilter(siteFilter === name ? '' : name)}>
                  <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '4px' }}>{name}</div>
                  <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text)' }}>{count}</div>
                </div>
              ))}
            </div>

            {/* ===== Filters + Actions ===== */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: '16px', flexWrap: 'wrap', gap: '10px',
            }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  value={phoneSearch}
                  onChange={e => setPhoneSearch(e.target.value)}
                  placeholder="🔍 ค้นหาเบอร์..."
                  style={{
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    color: 'var(--text)', padding: '8px 12px', borderRadius: '8px',
                    fontSize: '13px', width: '180px',
                  }}
                />
                <select
                  value={siteFilter}
                  onChange={e => setSiteFilter(e.target.value)}
                  style={{
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    color: 'var(--text2)', padding: '8px 12px', borderRadius: '8px',
                    fontSize: '13px',
                  }}
                >
                  <option value="">ทุกเว็บ</option>
                  {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
                <span style={{ fontSize: '13px', color: 'var(--text3)' }}>
                  แสดง {filtered.length} รายการ
                </span>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                {canAct && selectedIds.size > 0 && (
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={bulkUnlock}
                    disabled={bulkUnlocking}
                  >
                    {bulkUnlocking ? 'กำลังปลดล็อค...' : `🔓 ปลดล็อค ${selectedIds.size} เบอร์`}
                  </button>
                )}
                {canExport && (
                  <button className="btn-export" onClick={exportDnc} disabled={exporting}>
                    {exporting ? 'กำลังสร้าง...' : '📥 ออกรายงาน'}
                  </button>
                )}
              </div>
            </div>

            {/* ===== Toast ===== */}
            {toast && (
              <div style={{
                marginBottom: '12px', padding: '10px 16px', borderRadius: '8px',
                fontSize: '13px', fontWeight: 600,
                background: toast.includes('สำเร็จ') ? '#dcfce7' : '#fee2e2',
                color: toast.includes('สำเร็จ') ? '#166534' : '#991b1b',
              }}>
                {toast}
              </div>
            )}

            {/* ===== Table ===== */}
            <div className="table-wrap">
              <table>
                <thead className="dark">
                  <tr>
                    {canAct && (
                      <th style={{ width: '36px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={filtered.length > 0 && filtered.every(c => selectedIds.has(c.id))}
                          onChange={() => toggleAll(filtered)}
                          style={{ accentColor: 'var(--accent)' }}
                        />
                      </th>
                    )}
                    <th style={{ width: '40px' }}>#</th>
                    <th>เบอร์โทร</th>
                    <th>เว็บไซต์</th>
                    <th>เหตุผล</th>
                    <th>วันที่ตั้งค่า</th>
                    {canAct && <th style={{ width: '100px', textAlign: 'center' }}>จัดการ</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={canAct ? 7 : 5} style={{
                        textAlign: 'center', padding: '40px', color: 'var(--text3)',
                      }}>
                        ไม่พบเบอร์ห้ามโทร
                      </td>
                    </tr>
                  ) : filtered.map((c, i) => (
                    <tr key={c.id}>
                      {canAct && (
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(c.id)}
                            onChange={() => toggleSelect(c.id)}
                            style={{ accentColor: 'var(--accent)' }}
                          />
                        </td>
                      )}
                      <td style={{ color: 'var(--text3)', fontSize: '12px' }}>{i + 1}</td>
                      <td style={{ fontSize: '13px', fontWeight: 600 }}>0{c.phone}</td>
                      <td>
                        <a href={`/sites/${encodeURIComponent(c.siteName)}`}
                          style={{ color: 'var(--accent)', fontSize: '12px', textDecoration: 'none' }}
                        >
                          {c.siteName}
                        </a>
                      </td>
                      <td>
                        <span className="st" style={{
                          background: '#fee2e2', color: '#dc2626',
                          fontSize: '11px', fontWeight: 600,
                        }}>
                          {c.do_not_call_reason || 'ไม่ระบุ'}
                        </span>
                      </td>
                      <td style={{ fontSize: '12px', color: 'var(--text2)' }}>{c.call_date || '-'}</td>
                      {canAct && (
                        <td style={{ textAlign: 'center' }}>
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => unlockDnc(c)}
                            style={{ fontSize: '11px' }}
                          >
                            🔓 ปลดล็อค
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
