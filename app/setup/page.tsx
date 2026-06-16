'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SetupPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const router = useRouter()

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault()
    if (form.password !== form.confirm) { setError('รหัสผ่านไม่ตรงกัน'); return }
    if (form.password.length < 6) { setError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'); return }
    setLoading(true); setError('')
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'setup', email: form.email, password: form.password, full_name: form.name })
    })
    const data = await res.json()
    if (data.error) { setError(data.error); setLoading(false); return }
    setDone(true)
  }

  if (done) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '40px', maxWidth: '400px', textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
        <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>สร้างบัญชีแอดมินสำเร็จ!</h2>
        <p style={{ color: 'var(--text2)', marginBottom: '24px', fontSize: '13px' }}>สามารถเข้าสู่ระบบได้แล้ว</p>
        <button className="btn btn-primary" onClick={() => router.push('/login')} style={{ width: '100%' }}>ไปหน้า Login</button>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '20px' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '40px 36px', width: '100%', maxWidth: '420px' }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>⚙️</div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>ตั้งค่าระบบครั้งแรก</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '4px' }}>สร้างบัญชีแอดมิน</p>
        </div>
        <form onSubmit={handleSetup} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="form-group">
            <label>ชื่อ-นามสกุล</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="ชื่อผู้ดูแลระบบ" required />
          </div>
          <div className="form-group">
            <label>อีเมล</label>
            <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="admin@example.com" required />
          </div>
          <div className="form-group">
            <label>รหัสผ่าน</label>
            <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="อย่างน้อย 6 ตัวอักษร" required />
          </div>
          <div className="form-group">
            <label>ยืนยันรหัสผ่าน</label>
            <input type="password" value={form.confirm} onChange={e => setForm({ ...form, confirm: e.target.value })} placeholder="ยืนยันรหัสผ่าน" required />
          </div>
          {error && (
            <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid var(--red)', borderRadius: '8px', padding: '10px', fontSize: '13px', color: 'var(--red)' }}>{error}</div>
          )}
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', padding: '11px', marginTop: '4px' }}>
            {loading ? 'กำลังสร้าง...' : 'สร้างบัญชีแอดมิน'}
          </button>
        </form>
        <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '12px', color: 'var(--text3)' }}>
          <a href="/login" style={{ color: 'var(--accent)' }}>กลับหน้า Login</a>
        </p>
      </div>
    </div>
  )
}
