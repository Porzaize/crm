'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import type { Customer, Site } from '@/lib/types'

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
]
const DAY_HEADERS = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา']

function fmt(d: Date) { return d.toISOString().split('T')[0] }
function toBangkokDate(iso: string) {
  const d = new Date(iso)
  return new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
}

export default function CalendarPage() {
  const supabase = createClient()
  const today = new Date()
  const todayStr = fmt(today)

  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [callbacks, setCallbacks] = useState<(Customer & { siteName: string })[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [siteFilter, setSiteFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedCallback, setSelectedCallback] = useState<(Customer & { siteName: string }) | null>(null)
  const [userRole, setUserRole] = useState('')

  useEffect(() => { loadRole() }, [])
  useEffect(() => { loadData() }, [year, month, siteFilter])

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

    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const rangeStart = fmt(firstDay)
    const rangeEnd = fmt(lastDay)

    let q = supabase.from('customers').select('*, sites(name)')
      .not('next_call_at', 'is', null)
      .gte('next_call_at', rangeStart + 'T00:00:00')
      .lte('next_call_at', rangeEnd + 'T23:59:59')
      .order('next_call_at')

    if (siteFilter) {
      const site = (siteList || []).find(s => s.name === siteFilter)
      if (site) q = q.eq('site_id', site.id)
    }

    const { data } = await q
    setCallbacks((data || []).map(c => ({ ...c, siteName: c.sites?.name || '' })))
    setLoading(false)
  }

  // Group callbacks by date
  const byDate: Record<string, (Customer & { siteName: string })[]> = {}
  callbacks.forEach(c => {
    const dateKey = c.next_call_at ? toBangkokDate(c.next_call_at).toISOString().split('T')[0] : ''
    if (!dateKey) return
    if (!byDate[dateKey]) byDate[dateKey] = []
    byDate[dateKey].push(c)
  })

  // Summary stats
  const totalMonth = callbacks.length
  const overdueCount = callbacks.filter(c => {
    const d = c.next_call_at ? toBangkokDate(c.next_call_at) : null
    return d && fmt(d) < todayStr
  }).length
  const todayCount = callbacks.filter(c => {
    const d = c.next_call_at ? toBangkokDate(c.next_call_at) : null
    return d && fmt(d) === todayStr
  }).length
  const weekEnd = new Date(today)
  weekEnd.setDate(today.getDate() + (7 - today.getDay()))
  const upcomingWeek = callbacks.filter(c => {
    const d = c.next_call_at ? toBangkokDate(c.next_call_at) : null
    if (!d) return false
    const ds = fmt(d)
    return ds >= todayStr && ds <= fmt(weekEnd)
  }).length

  // Calendar grid
  const firstOfMonth = new Date(year, month, 1)
  let startDow = firstOfMonth.getDay() - 1 // Monday = 0
  if (startDow < 0) startDow = 6
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: (number | null)[] = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  function getDotColor(dateStr: string) {
    if (dateStr < todayStr) return '#ef4444' // overdue - red
    if (dateStr === todayStr) return '#3b82f6' // today - blue
    return '#22c55e' // future - green
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
    setSelectedDate(null)
    setSelectedCallback(null)
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
    setSelectedDate(null)
    setSelectedCallback(null)
  }
  function goToday() {
    setYear(today.getFullYear())
    setMonth(today.getMonth())
    setSelectedDate(null)
    setSelectedCallback(null)
  }

  const isViewer = userRole === 'viewer'

  const selectedCallbacks = selectedDate ? (byDate[selectedDate] || []) : []

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* Topbar */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '13px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50 }}>
        <div>
          <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>📅 ปฏิทินนัดโทรกลับ</h2>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>ดูตารางนัดหมายโทรกลับลูกค้าแบบรายเดือน</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <select
            value={siteFilter}
            onChange={e => setSiteFilter(e.target.value)}
            style={{ fontSize: '13px', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          >
            <option value="">ทุกเว็บ</option>
            {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </div>
      </div>

      <div style={{ padding: '20px 24px' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px', gap: '12px', color: 'var(--text3)' }}>
            <div className="spinner" /> กำลังโหลด...
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
              {[
                { label: 'นัดทั้งหมดเดือนนี้', value: totalMonth, color: '#6c63ff', icon: '📋' },
                { label: 'เลยกำหนด', value: overdueCount, color: '#ef4444', icon: '🔴' },
                { label: 'วันนี้', value: todayCount, color: '#3b82f6', icon: '📞' },
                { label: 'สัปดาห์นี้', value: upcomingWeek, color: '#22c55e', icon: '📆' },
              ].map(s => (
                <div key={s.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,.06)', padding: '16px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '6px' }}>{s.icon} {s.label}</div>
                  <div style={{ fontSize: '24px', fontWeight: 700, color: '#000' }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Calendar Navigation */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,.06)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                <button className="btn btn-outline btn-sm" onClick={prevMonth}>&lt; เดือนก่อน</button>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>
                    {THAI_MONTHS[month]} {year + 543}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn btn-primary btn-sm" onClick={goToday}>วันนี้</button>
                  <button className="btn btn-outline btn-sm" onClick={nextMonth}>เดือนถัดไป &gt;</button>
                </div>
              </div>

              {/* Day Headers */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border)' }}>
                {DAY_HEADERS.map((d, i) => (
                  <div key={i} style={{ padding: '10px', textAlign: 'center', fontSize: '13px', fontWeight: 600, color: i >= 5 ? '#ef4444' : 'var(--text2)', background: 'var(--bg)' }}>
                    {d}
                  </div>
                ))}
              </div>

              {/* Calendar Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                {cells.map((day, i) => {
                  if (day === null) {
                    return <div key={i} style={{ minHeight: '80px', borderBottom: '1px solid var(--border)', borderRight: i % 7 < 6 ? '1px solid var(--border)' : 'none', background: 'var(--bg)' }} />
                  }
                  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                  const dayCallbacks = byDate[dateStr] || []
                  const count = dayCallbacks.length
                  const isToday = dateStr === todayStr
                  const isSelected = dateStr === selectedDate
                  const dotColor = getDotColor(dateStr)

                  return (
                    <div
                      key={i}
                      onClick={() => { setSelectedDate(dateStr); setSelectedCallback(null) }}
                      style={{
                        minHeight: '80px',
                        padding: '8px',
                        borderBottom: '1px solid var(--border)',
                        borderRight: i % 7 < 6 ? '1px solid var(--border)' : 'none',
                        cursor: 'pointer',
                        background: isSelected ? 'rgba(108, 99, 255, 0.08)' : isToday ? 'rgba(59, 130, 246, 0.05)' : 'var(--surface)',
                        transition: 'background .15s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{
                          fontSize: '13px',
                          fontWeight: isToday ? 700 : 500,
                          color: isToday ? '#fff' : 'var(--text)',
                          background: isToday ? '#3b82f6' : 'transparent',
                          borderRadius: '50%',
                          width: isToday ? '26px' : 'auto',
                          height: isToday ? '26px' : 'auto',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          {day}
                        </span>
                        {count > 0 && (
                          <span style={{
                            background: dotColor,
                            color: '#fff',
                            fontSize: '10px',
                            fontWeight: 700,
                            borderRadius: '10px',
                            padding: '1px 7px',
                            minWidth: '20px',
                            textAlign: 'center',
                          }}>
                            {count}
                          </span>
                        )}
                      </div>
                      {count > 0 && count <= 3 && (
                        <div style={{ marginTop: '2px' }}>
                          {dayCallbacks.slice(0, 3).map(c => (
                            <div key={c.id} style={{ fontSize: '10px', color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {c.phone} · {c.siteName}
                            </div>
                          ))}
                        </div>
                      )}
                      {count > 3 && (
                        <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>
                          +{count} นัดหมาย
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Side Panel - selected date details */}
            {selectedDate && (
              <div style={{ marginTop: '20px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>
                      📋 นัดโทรกลับวันที่ {new Date(selectedDate + 'T00:00:00').toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </h3>
                    <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
                      ทั้งหมด {selectedCallbacks.length} รายการ
                      {selectedDate < todayStr && <span style={{ color: '#ef4444', marginLeft: '8px' }}>● เลยกำหนด</span>}
                      {selectedDate === todayStr && <span style={{ color: '#3b82f6', marginLeft: '8px' }}>● วันนี้</span>}
                      {selectedDate > todayStr && <span style={{ color: '#22c55e', marginLeft: '8px' }}>● กำหนดการ</span>}
                    </p>
                  </div>
                  <button className="btn btn-outline btn-sm" onClick={() => { setSelectedDate(null); setSelectedCallback(null) }}>✕ ปิด</button>
                </div>

                {selectedCallbacks.length === 0 ? (
                  <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text3)', fontSize: '13px' }}>
                    ไม่มีนัดโทรกลับในวันนี้
                  </div>
                ) : (
                  <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ background: 'var(--bg)' }}>
                          <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: 'var(--text2)', borderBottom: '1px solid var(--border)' }}>เบอร์โทร</th>
                          <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: 'var(--text2)', borderBottom: '1px solid var(--border)' }}>เว็บ</th>
                          <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: 'var(--text2)', borderBottom: '1px solid var(--border)' }}>เวลานัด</th>
                          <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: 'var(--text2)', borderBottom: '1px solid var(--border)' }}>หมายเหตุ</th>
                          {!isViewer && (
                            <th style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, color: 'var(--text2)', borderBottom: '1px solid var(--border)' }}>จัดการ</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedCallbacks.map(c => {
                          const callTime = c.next_call_at ? toBangkokDate(c.next_call_at) : null
                          const timeStr = callTime ? callTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-'
                          return (
                            <tr
                              key={c.id}
                              onClick={() => setSelectedCallback(c)}
                              style={{ cursor: 'pointer', background: selectedCallback?.id === c.id ? 'rgba(108, 99, 255, 0.06)' : 'transparent', transition: 'background .15s' }}
                            >
                              <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600, color: 'var(--accent)' }}>
                                {c.phone}
                              </td>
                              <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>
                                {c.siteName}
                              </td>
                              <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', color: 'var(--text2)' }}>
                                {timeStr}
                              </td>
                              <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', color: 'var(--text3)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {c.note || '-'}
                              </td>
                              {!isViewer && (
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
                                  <button
                                    className="btn btn-outline btn-sm"
                                    onClick={(e) => { e.stopPropagation(); setSelectedCallback(c) }}
                                  >
                                    ดูรายละเอียด
                                  </button>
                                </td>
                              )}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Callback Detail Modal */}
            {selectedCallback && (
              <div
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
                onClick={() => setSelectedCallback(null)}
              >
                <div
                  style={{ background: 'var(--surface)', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,.15)', width: '100%', maxWidth: '420px', overflow: 'hidden' }}
                  onClick={e => e.stopPropagation()}
                >
                  <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>📞 รายละเอียดนัดโทรกลับ</h3>
                    <button className="btn btn-outline btn-sm" onClick={() => setSelectedCallback(null)}>✕</button>
                  </div>
                  <div style={{ padding: '20px 22px' }}>
                    {[
                      { label: 'เบอร์โทร', value: selectedCallback.phone, accent: true },
                      { label: 'เว็บ', value: selectedCallback.siteName },
                      { label: 'วันนัดโทร', value: selectedCallback.next_call_at ? toBangkokDate(selectedCallback.next_call_at).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '-' },
                      { label: 'เวลานัด', value: selectedCallback.next_call_at ? toBangkokDate(selectedCallback.next_call_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-' },
                      { label: 'หมายเหตุ', value: selectedCallback.note || '-' },
                      { label: 'สถานะ DNC', value: selectedCallback.do_not_call ? `ห้ามโทร: ${selectedCallback.do_not_call_reason || '-'}` : 'ปกติ' },
                      { label: 'จำนวนโทร', value: `${selectedCallback.call_count || 0} ครั้ง` },
                    ].map(item => (
                      <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontSize: '13px', color: 'var(--text3)' }}>{item.label}</span>
                        <span style={{ fontSize: '13px', fontWeight: item.accent ? 700 : 500, color: item.accent ? 'var(--accent)' : 'var(--text)' }}>
                          {item.value}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <button className="btn btn-outline btn-sm" onClick={() => setSelectedCallback(null)}>ปิด</button>
                  </div>
                </div>
              </div>
            )}

            {/* Legend */}
            <div style={{ marginTop: '16px', display: 'flex', gap: '20px', alignItems: 'center', fontSize: '12px', color: 'var(--text3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
                เลยกำหนด
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#3b82f6', display: 'inline-block' }} />
                วันนี้
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
                กำหนดการ
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
