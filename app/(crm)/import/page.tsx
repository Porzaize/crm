'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase-client'
import { logAudit } from '@/lib/audit'
import type { Site } from '@/lib/types'

interface PreviewRow {
  phone: string
  call_date: string
  [key: string]: string
}

interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
}

export default function ImportExportPage() {
  const supabase = createClient()

  // Role
  const [userRole, setUserRole] = useState('')
  const [loading, setLoading] = useState(true)

  // Sites
  const [sites, setSites] = useState<Site[]>([])

  // Import state
  const [importSiteId, setImportSiteId] = useState<number>(0)
  const [dragActive, setDragActive] = useState(false)
  const [fileName, setFileName] = useState('')
  const [rawRows, setRawRows] = useState<string[][]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [phoneCol, setPhoneCol] = useState<number>(-1)
  const [dateCol, setDateCol] = useState<number>(-1)
  const [previewData, setPreviewData] = useState<PreviewRow[]>([])
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Toast
  const [toast, setToast] = useState({ msg: '', type: '' })

  const isViewer = userRole === 'viewer'
  const isEditor = userRole === 'editor'
  const canImport = userRole === 'admin' || userRole === 'manager'


  async function loadRole() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const saved = localStorage.getItem('impersonate_role')
    const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', user.id).single()
    const real = profile?.role || user.user_metadata?.role || ''
    if (saved && (real === 'manager' || real === 'admin')) setUserRole(saved)
    else setUserRole(real)
  }

  async function loadSites() {
    const { data } = await supabase.from('sites').select('*').order('id')
    setSites(data || [])
  }

  useEffect(() => {
    Promise.all([loadRole(), loadSites()]).then(() => setLoading(false))
  }, [])

  function showToast(msg: string, type: string = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast({ msg: '', type: '' }), 4000)
  }

  // ─── CSV Parsing ───

  function parseCSV(text: string): string[][] {
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    return lines.map(line => {
      const result: string[] = []
      let current = ''
      let inQuotes = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (inQuotes) {
          if (ch === '"' && line[i + 1] === '"') { current += '"'; i++ }
          else if (ch === '"') inQuotes = false
          else current += ch
        } else {
          if (ch === '"') inQuotes = true
          else if (ch === ',') { result.push(current.trim()); current = '' }
          else current += ch
        }
      }
      result.push(current.trim())
      return result
    })
  }

  function cleanPhone(raw: string): string {
    let p = raw.replace(/[-\s().+]/g, '')
    if (p.startsWith('66') && p.length === 11) p = p.slice(2)
    if (p.startsWith('0')) p = p.slice(1)
    return p
  }

  function detectColumns(hdrs: string[]) {
    let pCol = -1, dCol = -1
    const lower = hdrs.map(h => h.toLowerCase().replace(/\s/g, ''))
    lower.forEach((h, i) => {
      if (pCol === -1 && (h.includes('phone') || h.includes('tel') || h.includes('เบอร์') || h.includes('โทร'))) pCol = i
      if (dCol === -1 && (h.includes('date') || h.includes('วัน') || h.includes('call_date'))) dCol = i
    })
    return { pCol, dCol }
  }

  function processFile(text: string) {
    const rows = parseCSV(text)
    if (rows.length < 2) { showToast('ไฟล์ไม่มีข้อมูล', 'error'); return }

    const hdrs = rows[0]
    const dataRows = rows.slice(1)
    const { pCol, dCol } = detectColumns(hdrs)

    setHeaders(hdrs)
    setRawRows(dataRows)
    setPhoneCol(pCol)
    setDateCol(dCol)
    setImportResult(null)

    // Build preview (first 10 rows)
    const preview: PreviewRow[] = dataRows.slice(0, 10).map(row => ({
      phone: pCol >= 0 ? cleanPhone(row[pCol] || '') : '',
      call_date: dCol >= 0 ? (row[dCol] || '') : '',
      ...Object.fromEntries(hdrs.map((h, i) => [h, row[i] || '']))
    }))
    setPreviewData(preview)
  }

  function handleFileSelect(file: File) {
    if (!file) return
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext !== 'csv' && ext !== 'txt') {
      showToast('รองรับเฉพาะไฟล์ .csv เท่านั้น', 'error')
      return
    }
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      processFile(text)
    }
    reader.readAsText(file, 'UTF-8')
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragActive(true)
  }

  function handleDragLeave() {
    setDragActive(false)
  }

  function resetImport() {
    setFileName('')
    setRawRows([])
    setHeaders([])
    setPhoneCol(-1)
    setDateCol(-1)
    setPreviewData([])
    setImportResult(null)
    setImportProgress(0)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ─── Import Logic ───

  async function doImport() {
    if (phoneCol < 0) { showToast('กรุณาเลือกคอลัมน์เบอร์โทร', 'error'); return }
    if (!importSiteId) { showToast('กรุณาเลือกเว็บ', 'error'); return }

    setImporting(true)
    setImportProgress(0)
    setImportResult(null)

    // Fetch existing phones for this site to check duplicates
    const { data: existing } = await supabase
      .from('customers')
      .select('phone')
      .eq('site_id', importSiteId)

    const existingPhones = new Set((existing || []).map(c => c.phone))

    // Get max seq for site
    const { data: maxSeqData } = await supabase
      .from('customers')
      .select('seq')
      .eq('site_id', importSiteId)
      .order('seq', { ascending: false })
      .limit(1)

    let nextSeq = (maxSeqData?.[0]?.seq || 0) + 1

    let imported = 0
    let skipped = 0
    const errors: string[] = []
    const batchSize = 50
    const toInsert: Array<Record<string, unknown>> = []

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i]
      const phone = cleanPhone(row[phoneCol] || '')

      if (!phone || phone.length < 8) {
        errors.push(`แถว ${i + 2}: เบอร์โทรไม่ถูกต้อง "${row[phoneCol] || ''}"`)
        continue
      }

      if (existingPhones.has(phone)) {
        skipped++
        continue
      }

      // Prevent duplicate within the import batch
      existingPhones.add(phone)

      const callDate = dateCol >= 0 ? (row[dateCol] || '') : new Date().toISOString().split('T')[0]

      toInsert.push({
        site_id: importSiteId,
        seq: nextSeq++,
        phone,
        call_date: callDate,
        call_time: '',
        answered: false,
        not_answered: false,
        sms_sent: false,
        total_deposit: 0,
        note: '',
      })
    }

    // Insert in batches
    const totalBatches = Math.ceil(toInsert.length / batchSize)
    for (let b = 0; b < totalBatches; b++) {
      const batch = toInsert.slice(b * batchSize, (b + 1) * batchSize)
      const { error } = await supabase.from('customers').insert(batch)
      if (error) {
        errors.push(`Batch ${b + 1}: ${error.message}`)
      } else {
        imported += batch.length
      }
      setImportProgress(Math.round(((b + 1) / totalBatches) * 100))
    }

    setImportResult({ imported, skipped, errors })
    setImporting(false)

    logAudit({
      action: 'import.customers',
      entity: 'Customer',
      entityId: `site_${importSiteId}`,
      after: { imported, skipped, errors: errors.length, file: fileName }
    })

    if (imported > 0) {
      showToast(`นำเข้าสำเร็จ ${imported} รายการ`)
    }
  }

  // ─── Render ───

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', flexDirection: 'column', gap: '12px' }}>
      <div className="spinner" /> กำลังโหลด...
    </div>
  }

  if (isViewer) {
    return (
      <>
        <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fff', borderBottom: '1px solid var(--border)', padding: '13px 24px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>นำเข้า / ส่งออกข้อมูลลูกค้า</h2>
          <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>Import & Export Customers</div>
        </div>
        <div style={{ padding: '40px 24px', textAlign: 'center' }}>
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px',
            boxShadow: '0 1px 3px rgba(0,0,0,.06)', padding: '40px', maxWidth: '500px', margin: '0 auto'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔒</div>
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)', marginBottom: '8px' }}>ไม่มีสิทธิ์เข้าถึง</h3>
            <p style={{ fontSize: '13px', color: 'var(--text3)' }}>บทบาท Viewer ไม่สามารถนำเข้าหรือส่งออกข้อมูลได้ กรุณาติดต่อผู้ดูแลระบบ</p>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      {/* Toast */}
      {toast.msg && (
        <div style={{
          position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
          background: toast.type === 'error' ? 'var(--red)' : 'var(--green)',
          color: '#fff', padding: '12px 20px', borderRadius: '8px', fontSize: '13px',
          boxShadow: '0 4px 12px rgba(0,0,0,.15)', maxWidth: '400px',
        }}>
          {toast.msg}
        </div>
      )}

      {/* Topbar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fff', borderBottom: '1px solid var(--border)', padding: '16px 28px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>นำเข้าข้อมูลลูกค้า</h2>
        <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '3px' }}>Import Customers</div>
      </div>

      <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '24px' }}>

        {/* ═══════════ IMPORT SECTION ═══════════ */}
        {canImport && (
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px',
            boxShadow: '0 1px 3px rgba(0,0,0,.06)', padding: '32px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
              <div>
                <h3 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: 'var(--text)' }}>📤 นำเข้าข้อมูล (Import)</h3>
                <p style={{ fontSize: '13px', color: 'var(--text3)', marginTop: '6px' }}>อัปโหลดไฟล์ CSV เพื่อนำเข้ารายชื่อลูกค้าใหม่</p>
              </div>
              {fileName && (
                <button className="btn btn-outline btn-sm" onClick={resetImport} style={{ fontSize: '12px' }}>
                  ล้างข้อมูล
                </button>
              )}
            </div>

            {/* Step 1: Site Selector */}
            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: '8px' }}>
                1. เลือกเว็บ
              </label>
              <select
                value={importSiteId}
                onChange={e => setImportSiteId(Number(e.target.value))}
                style={{
                  width: '100%', maxWidth: '400px', padding: '10px 14px', fontSize: '14px',
                  border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg)',
                  color: 'var(--text)',
                }}
              >
                <option value={0}>-- เลือกเว็บ --</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            {/* Step 2: File Upload Zone */}
            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: '8px' }}>
                2. เลือกไฟล์ CSV
              </label>

              {!fileName ? (
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${dragActive ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: '16px',
                    padding: '60px 32px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    background: dragActive ? 'rgba(108,99,255,.05)' : 'var(--bg)',
                    transition: 'all .2s',
                  }}
                >
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>📁</div>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)', marginBottom: '8px' }}>
                    ลากไฟล์มาวางที่นี่
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text3)' }}>
                    หรือคลิกเพื่อเลือกไฟล์ (รองรับ .csv)
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.txt"
                    onChange={e => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]) }}
                    style={{ display: 'none' }}
                  />
                </div>
              ) : (
                <div style={{
                  border: '1px solid var(--border)', borderRadius: '8px', padding: '12px 16px',
                  background: 'var(--bg)', display: 'flex', alignItems: 'center', gap: '10px'
                }}>
                  <span style={{ fontSize: '20px' }}>📄</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>{fileName}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text3)' }}>{rawRows.length} แถว, {headers.length} คอลัมน์</div>
                  </div>
                  <button className="btn btn-outline btn-sm" onClick={resetImport} style={{ fontSize: '11px' }}>เปลี่ยนไฟล์</button>
                </div>
              )}
            </div>

            {/* Step 3: Column Mapping */}
            {headers.length > 0 && (
              <div className="form-group" style={{ marginBottom: '24px' }}>
                <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: '8px' }}>
                  3. จับคู่คอลัมน์
                </label>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 200px' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '4px' }}>เบอร์โทร (phone) *</div>
                    <select
                      value={phoneCol}
                      onChange={e => {
                        setPhoneCol(Number(e.target.value))
                        // Rebuild preview
                        const newPreview = rawRows.slice(0, 10).map(row => ({
                          phone: Number(e.target.value) >= 0 ? cleanPhone(row[Number(e.target.value)] || '') : '',
                          call_date: dateCol >= 0 ? (row[dateCol] || '') : '',
                          ...Object.fromEntries(headers.map((h, i) => [h, row[i] || '']))
                        }))
                        setPreviewData(newPreview)
                      }}
                      style={{
                        width: '100%', padding: '8px 12px', fontSize: '13px',
                        border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg)', color: 'var(--text)',
                      }}
                    >
                      <option value={-1}>-- เลือกคอลัมน์ --</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: '1 1 200px' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '4px' }}>วันที่โทร (call_date)</div>
                    <select
                      value={dateCol}
                      onChange={e => {
                        setDateCol(Number(e.target.value))
                        const newPreview = rawRows.slice(0, 10).map(row => ({
                          phone: phoneCol >= 0 ? cleanPhone(row[phoneCol] || '') : '',
                          call_date: Number(e.target.value) >= 0 ? (row[Number(e.target.value)] || '') : '',
                          ...Object.fromEntries(headers.map((h, i) => [h, row[i] || '']))
                        }))
                        setPreviewData(newPreview)
                      }}
                      style={{
                        width: '100%', padding: '8px 12px', fontSize: '13px',
                        border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg)', color: 'var(--text)',
                      }}
                    >
                      <option value={-1}>-- ไม่ระบุ (ใช้วันนี้) --</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: Preview Table */}
            {previewData.length > 0 && (
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: '6px' }}>
                  4. ตัวอย่างข้อมูล ({Math.min(10, rawRows.length)} จาก {rawRows.length} แถว)
                </label>
                <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '8px' }}>
                  <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg)' }}>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--text2)', borderBottom: '1px solid var(--border)' }}>#</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--accent)', borderBottom: '1px solid var(--border)' }}>เบอร์โทร</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--accent)', borderBottom: '1px solid var(--border)' }}>วันที่โทร</th>
                        {headers.map((h, i) => (
                          i !== phoneCol && i !== dateCol && (
                            <th key={i} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--text3)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                          )
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.map((row, ri) => (
                        <tr key={ri} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '6px 12px', color: 'var(--text3)' }}>{ri + 1}</td>
                          <td style={{ padding: '6px 12px', fontWeight: 600, color: 'var(--text)' }}>
                            {row.phone ? `0${row.phone}` : <span style={{ color: 'var(--red)' }}>ไม่พบ</span>}
                          </td>
                          <td style={{ padding: '6px 12px', color: 'var(--text2)' }}>{row.call_date || '-'}</td>
                          {headers.map((h, i) => (
                            i !== phoneCol && i !== dateCol && (
                              <td key={i} style={{ padding: '6px 12px', color: 'var(--text3)' }}>{row[h] || ''}</td>
                            )
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Step 5: Import Button */}
            {previewData.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
                <button
                  className="btn btn-primary"
                  onClick={doImport}
                  disabled={importing || phoneCol < 0 || !importSiteId}
                  style={{ fontSize: '13px', padding: '10px 24px' }}
                >
                  {importing ? (
                    <>
                      <span className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px', verticalAlign: 'middle', marginRight: '6px' }} />
                      กำลังนำเข้า... {importProgress}%
                    </>
                  ) : (
                    <>📤 นำเข้าข้อมูล ({rawRows.length} แถว)</>
                  )}
                </button>
                {importing && (
                  <div style={{ flex: 1, background: 'var(--bg)', borderRadius: '8px', height: '8px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${importProgress}%`, height: '100%',
                      background: 'var(--accent)', borderRadius: '8px',
                      transition: 'width .3s',
                    }} />
                  </div>
                )}
              </div>
            )}

            {/* Import Result */}
            {importResult && (
              <div style={{
                marginTop: '16px', padding: '16px', borderRadius: '8px',
                background: importResult.errors.length > 0 ? 'rgba(220,38,38,.06)' : 'rgba(22,163,74,.06)',
                border: `1px solid ${importResult.errors.length > 0 ? 'rgba(220,38,38,.2)' : 'rgba(22,163,74,.2)'}`,
              }}>
                <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '10px', color: 'var(--text)' }}>
                  ผลลัพธ์การนำเข้า
                </div>
                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', fontSize: '13px' }}>
                  <div>
                    <span style={{ color: 'var(--green)', fontWeight: 700 }}>✓ นำเข้าสำเร็จ:</span>{' '}
                    <strong>{importResult.imported}</strong> รายการ
                  </div>
                  <div>
                    <span style={{ color: 'var(--text3)', fontWeight: 600 }}>⊘ ข้ามซ้ำ:</span>{' '}
                    <strong>{importResult.skipped}</strong> รายการ
                  </div>
                  {importResult.errors.length > 0 && (
                    <div>
                      <span style={{ color: 'var(--red)', fontWeight: 600 }}>✕ ข้อผิดพลาด:</span>{' '}
                      <strong>{importResult.errors.length}</strong> รายการ
                    </div>
                  )}
                </div>
                {importResult.errors.length > 0 && (
                  <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--red)', maxHeight: '120px', overflowY: 'auto' }}>
                    {importResult.errors.map((err, i) => <div key={i}>• {err}</div>)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Editor cannot import message */}
        {isEditor && (
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px',
            boxShadow: '0 1px 3px rgba(0,0,0,.06)', padding: '24px', textAlign: 'center',
          }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>🔒</div>
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', marginBottom: '6px' }}>ไม่มีสิทธิ์เข้าถึง</h3>
            <p style={{ fontSize: '12px', color: 'var(--text3)' }}>บทบาท Editor ไม่สามารถนำเข้าข้อมูลได้</p>
          </div>
        )}
      </div>
    </>
  )
}
