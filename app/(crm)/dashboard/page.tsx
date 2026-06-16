'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { SITE_ORDER } from '@/lib/constants'
import type { WeeklySummary } from '@/lib/types'

const SITE_COLORS: Record<string, { fromLight: string; from: string; to: string; light: string; text: string }> = {
  'มรกต':      { fromLight: '#60bec7', from: '#0f7279', to: '#064e57', light: '#ccf5f7', text: '#0a5560' },
  'เป๋าตุง168': { fromLight: '#90d4e8', from: '#4ab3d0', to: '#1a7a9e', light: '#e0f4fa', text: '#1e6f8a' },
  'หวยพลัส':   { fromLight: '#7fc970', from: '#2d8c1e', to: '#0f4a08', light: '#dcfce7', text: '#166534' },
  'ตัวเต็ง168': { fromLight: '#7b6bb5', from: '#3d2a8a', to: '#110a42', light: '#ede9fe', text: '#3730a3' },
  'เมก้า168':   { fromLight: '#7096cc', from: '#2b52a8', to: '#0f1f5a', light: '#dbeafe', text: '#1e3a8a' },
  'ออมสิน168':  { fromLight: '#f490bf', from: '#ec4899', to: '#9d1a5a', light: '#fce7f3', text: '#9d174d' },
  'มณี159':    { fromLight: '#6ab585', from: '#1a6b3a', to: '#0a3a1e', light: '#dcfce7', text: '#145228' },
  'ไพศาล':     { fromLight: '#6e85c0', from: '#1e3a8a', to: '#0a1232', light: '#dbeafe', text: '#1e3a8a' },
  'แสงเพชร':   { fromLight: '#b0b8c4', from: '#6b7280', to: '#374151', light: '#f3f4f6', text: '#374151' },
}
const FALLBACK_COLORS = [
  { from: '#6c63ff', to: '#4f46e5', light: '#ede9fe', text: '#4f46e5' },
  { from: '#14b8a6', to: '#0d9488', light: '#ccfbf1', text: '#115e59' },
]


export default function DashboardPage() {
  const [weekly, setWeekly] = useState<(WeeklySummary & { siteName: string })[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data: w } = await supabase
      .from('weekly_summary').select('*, sites(name)')
    const mapped = (w || []).map(r => ({ ...r, siteName: r.sites?.name || '' }))
    mapped.sort((a, b) => {
      const ai = SITE_ORDER.indexOf(a.siteName)
      const bi = SITE_ORDER.indexOf(b.siteName)
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
    })
    setWeekly(mapped)
    setLoading(false)
  }

  const totalCalls = weekly.reduce((s, w) => s + (w.total_calls || 0), 0)
  const totalAnswered = weekly.reduce((s, w) => s + (w.answered || 0), 0)
  const totalReturned = weekly.reduce((s, w) => s + (w.return_customers || 0), 0)
  const totalDeposit = weekly.reduce((s, w) => s + parseFloat(String(w.return_deposit || 0)), 0)
  const totalBonus = weekly.reduce((s, w) => s + parseFloat(String(w.bonus || 0)), 0)
  const answerRate = totalCalls > 0 ? ((totalAnswered / totalCalls) * 100).toFixed(1) : '0'
  const returnRate = totalCalls > 0 ? ((totalReturned / totalCalls) * 100).toFixed(1) : '0'

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* Topbar */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '13px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50 }}>
        <div>
          <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#111827' }}>📊 Dashboard ภาพรวม</h2>
          <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>สรุปผลการโทรติดตามลูกค้าขาดฝาก</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#f9fafb', border: '1px solid #e5e7eb', padding: '6px 14px', borderRadius: '20px', fontSize: '13px', color: '#6b7280' }}>
          <span>🕐</span>
          <span>อัปเดตล่าสุด: {new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </div>
      </div>

      {/* ── Grand Total Banner ── */}
      <div style={{ background: '#d5d8dc', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0', borderRadius: '0' }}>
        {/* Stats */}
        {[
          { label: 'ยอดรวมทั้งหมด', value: `฿${totalDeposit.toLocaleString('th-TH', { maximumFractionDigits: 0 })}`, pct: '', color: '#1f2937' },
          { label: 'โทรทั้งหมด',  value: totalCalls.toLocaleString(),                                          pct: `${weekly.length} เว็บ`,                                                             color: '#1f2937' },
          { label: 'รับสาย',      value: totalAnswered.toLocaleString(),                                       pct: `${answerRate}%`,                                                                    color: '#16a34a' },
          { label: 'ไม่รับสาย',   value: (totalCalls - totalAnswered).toLocaleString(),                        pct: `${totalCalls > 0 ? (100 - parseFloat(answerRate)).toFixed(1) : 0}%`,               color: '#dc2626' },
          { label: 'กลับมาฝาก',  value: `${totalReturned.toLocaleString()} ราย`,                              pct: `${returnRate}%`,                                                                    color: '#ea580c' },
          { label: 'โบนัสรวม',   value: `฿${totalBonus.toLocaleString('th-TH', { maximumFractionDigits: 0 })}`, pct: `ROI ${totalDeposit > 0 ? ((totalBonus / totalDeposit) * 100).toFixed(1) : 0}%`, color: '#2563eb' },
        ].map((s, i, arr) => (
          <div key={s.label} style={{ flex: 1, textAlign: 'center', padding: '0 24px', borderRight: i < arr.length - 1 ? '1px solid rgba(0,0,0,.1)' : 'none' }}>
            <div style={{ fontSize: '11px', color: '#1f2937', letterSpacing: '.5px', marginBottom: '5px' }}>{s.label}</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: '11px', color: '#1f2937', marginTop: '4px', fontWeight: 500, visibility: s.pct ? 'visible' : 'hidden' }}>{s.pct || '-'}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: '24px 28px' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px', gap: '12px', color: '#6b7280' }}>
            <div className="spinner" /> กำลังโหลดข้อมูล...
          </div>
        ) : (
          <>
            {/* ── Section title ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <span style={{ fontSize: '15px', fontWeight: 700, color: '#111827' }}>🌐 ผลลัพธ์แต่ละเว็บ</span>
              <span style={{ background: '#6c63ff', color: '#fff', fontSize: '11px', fontWeight: 700, padding: '2px 10px', borderRadius: '20px' }}>{weekly.length} เว็บ</span>
            </div>

            {/* ── Site Cards Grid ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px' }}>
              {weekly.map((w, i) => {
                const color = SITE_COLORS[w.siteName] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]
                const dep = parseFloat(String(w.return_deposit || 0))
                const bon = parseFloat(String(w.bonus || 0))
                const rate = w.total_calls > 0 ? (w.answered / w.total_calls) * 100 : 0
                const roi = dep > 0 ? (bon / dep) * 100 : 0
                const returnPct = w.total_calls > 0 ? (w.return_customers / w.total_calls) * 100 : 0

                return (
                  <a key={w.id} href={`/sites/${encodeURIComponent(w.siteName)}`}
                    style={{ textDecoration: 'none', display: 'block', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,.07)', transition: 'transform .15s, box-shadow .15s', cursor: 'pointer' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 18px rgba(0,0,0,.12)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 10px rgba(0,0,0,.07)' }}
                  >
                    {/* Card Header */}
                    <div style={{ background: `linear-gradient(to right, ${color.fromLight}, ${color.from}, ${color.to})`, padding: '12px 16px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontSize: '16px', fontWeight: 800, color: '#fff', marginBottom: '1px' }}>{w.siteName}</div>
                          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,.9)' }}>โทร {w.total_calls} ราย</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '18px', fontWeight: 800, color: '#fff' }}>฿{dep.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</div>
                          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,.75)' }}>ยอดฝากกลับมา</div>
                        </div>
                      </div>

                      {/* Answer rate bar */}
                      <div style={{ marginTop: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,.9)' }}>อัตรารับสาย</span>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>{rate.toFixed(1)}%</span>
                        </div>
                        <div style={{ background: 'rgba(255,255,255,.25)', borderRadius: '4px', height: '5px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', background: '#fff', borderRadius: '4px', width: `${rate}%`, transition: 'width .5s' }} />
                        </div>
                      </div>
                    </div>

                    {/* Card Body */}
                    <div style={{ background: '#fff', padding: '10px 16px 12px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '8px', marginBottom: '10px' }}>
                        {[
                          { label: 'รับสาย', value: w.answered, color: '#059669', bg: '#f0fdf4' },
                          { label: 'ไม่รับสาย', value: w.not_answered, color: '#dc2626', bg: '#fef2f2' },
                          { label: 'กลับมาฝาก', value: w.return_customers, color: '#334155', bg: '#f1f5f9' },
                        ].map(stat => (
                          <div key={stat.label} style={{ background: stat.bg, borderRadius: '8px', padding: '6px', textAlign: 'center' }}>
                            <div style={{ fontSize: '16px', fontWeight: 800, color: stat.color }}>{stat.value}</div>
                            <div style={{ fontSize: '11px', color: '#374151', marginTop: '1px', fontWeight: 600 }}>{stat.label}</div>
                          </div>
                        ))}
                      </div>

                      {/* Return rate bar */}
                      <div style={{ marginBottom: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                          <span style={{ fontSize: '11px', color: '#374151', fontWeight: 500 }}>กลับมาฝาก</span>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: color.text }}>{returnPct.toFixed(1)}%</span>
                        </div>
                        <div style={{ background: '#f3f4f6', borderRadius: '3px', height: '4px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', background: `linear-gradient(90deg, ${color.from}, ${color.to})`, borderRadius: '3px', width: `${Math.min(returnPct * 2, 100)}%`, transition: 'width .5s' }} />
                        </div>
                      </div>

                      {/* Bonus row */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f9fafb', borderRadius: '8px', padding: '7px 10px' }}>
                        <div>
                          <div style={{ fontSize: '11px', color: '#374151', fontWeight: 600 }}>โบนัส</div>
                          <div style={{ fontSize: '13px', fontWeight: 700, color: '#1f2937' }}>฿{bon.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '11px', color: '#374151', fontWeight: 600 }}>ROI โบนัส</div>
                          <div style={{ fontSize: '13px', fontWeight: 700, color: roi > 5 ? '#059669' : '#d97706' }}>{roi.toFixed(1)}%</div>
                        </div>
                        <div style={{ background: '#e2e8f0', color: '#475569', fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '14px' }}>
                          ดูรายละเอียด →
                        </div>
                      </div>
                    </div>
                  </a>
                )
              })}
            </div>

          </>
        )}
      </div>
    </div>
  )
}
