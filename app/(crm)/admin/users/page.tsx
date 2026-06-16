'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import type { UserProfile, Site } from '@/lib/types'

const ROLES = [
  { value: 'admin',   label: 'Admin',   desc: 'จัดการทุกอย่าง รวมถึงผู้ใช้',  color: 'var(--accent)' },
  { value: 'manager', label: 'Manager', desc: 'ผู้ช่วยแอดมิน เพิ่ม/แก้ไข + ดูผู้ใช้', color: '#0891b2' },
  { value: 'editor',  label: 'Editor',  desc: 'เพิ่ม/แก้ไขข้อมูล',            color: 'var(--yellow)' },
  { value: 'viewer',  label: 'Viewer',  desc: 'ดูข้อมูลอย่างเดียว',           color: 'var(--text2)' },
]

interface FormData {
  full_name: string; email: string; password: string; role: string; site_access: string[]
}

export default function UsersPage() {
  const [users, setUsers] = useState<(UserProfile & { email: string })[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser] = useState<(UserProfile & { email: string }) | null>(null)
  const [form, setForm] = useState<FormData>({ full_name: '', email: '', password: '', role: 'viewer', site_access: [] })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState({ msg: '', type: '' })
  const supabase = createClient()

  useEffect(() => {
    loadUsers()
    supabase.from('sites').select('*').order('id').then(({ data }) => setSites(data || []))
  }, [])

  async function loadUsers() {
    setLoading(true)
    const res = await fetch('/api/users')
    const data = await res.json()
    setUsers(data.users || [])
    setLoading(false)
  }

  function openAdd(defaultRole = 'viewer') {
    setEditUser(null)
    setForm({ full_name: '', email: '', password: '', role: defaultRole, site_access: [] })
    setShowModal(true)
  }

  function openEdit(u: UserProfile & { email: string }) {
    setEditUser(u)
    setForm({ full_name: u.full_name, email: u.email, password: '', role: u.role, site_access: u.site_access || [] })
    setShowModal(true)
  }

  async function handleSave() {
    setSaving(true)
    const body = editUser
      ? { action: 'update', id: editUser.id, ...form }
      : { action: 'create', ...form }
    const res = await fetch('/api/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await res.json()
    if (data.error) {
      setToast({ msg: data.error, type: 'error' })
    } else {
      setToast({ msg: editUser ? 'อัปเดตผู้ใช้สำเร็จ' : 'สร้างผู้ใช้สำเร็จ', type: 'success' })
      setShowModal(false)
      loadUsers()
    }
    setSaving(false)
    setTimeout(() => setToast({ msg: '', type: '' }), 3000)
  }

  async function handleDelete(u: UserProfile & { email: string }) {
    if (!confirm(`ลบผู้ใช้ ${u.full_name} (${u.email})?`)) return
    await fetch('/api/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id: u.id })
    })
    setToast({ msg: 'ลบผู้ใช้สำเร็จ', type: 'success' })
    loadUsers()
    setTimeout(() => setToast({ msg: '', type: '' }), 3000)
  }

  const roleInfo = (role: string) => ROLES.find(r => r.value === role) || ROLES[2]

  return (
    <div>
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '13px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50 }}>
        <h2 style={{ fontSize: '15px', fontWeight: 600 }}>👥 จัดการผู้ใช้งาน</h2>
        <button className="btn btn-primary btn-sm" onClick={() => openAdd()}>+ เพิ่มพนักงาน</button>
      </div>
      <div style={{ padding: '20px' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', gap: '10px', color: 'var(--text3)' }}><div className="spinner" /> กำลังโหลด...</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>ชื่อ</th><th>อีเมล</th><th>สิทธิ์</th><th>เว็บที่เข้าถึงได้</th><th>วันที่สร้าง</th><th>จัดการ</th></tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const r = roleInfo(u.role)
                  return (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 600 }}>{u.full_name}</td>
                      <td style={{ color: 'var(--text2)', fontSize: '12px', fontFamily: 'monospace' }}>{u.email}</td>
                      <td><span style={{ background: `${r.color}22`, color: r.color, padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>{r.label}</span></td>
                      <td style={{ fontSize: '12px', color: 'var(--text2)' }}>{u.site_access ? u.site_access.join(', ') : 'ทุกเว็บ'}</td>
                      <td style={{ fontSize: '12px', color: 'var(--text3)' }}>{new Date(u.created_at).toLocaleDateString('th-TH')}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button className="btn btn-outline btn-xs" onClick={() => openEdit(u)}>✏️ แก้ไข</button>
                          <button className="btn btn-xs" style={{ background: 'rgba(239,68,68,.1)', border: '1px solid var(--red)', color: 'var(--red)' }} onClick={() => handleDelete(u)}>🗑️</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="overlay show" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">{editUser ? '✏️ แก้ไขพนักงาน' : '➕ เพิ่มพนักงานใหม่'}</span>
              <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-group">
                <label>ชื่อพนักงาน (Username)</label>
                <input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} placeholder="ชื่อ-นามสกุล หรือชื่อเล่น" />
              </div>

              <div className="form-group">
                <label>ตำแหน่ง / สิทธิ์การใช้งาน (Role)</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {ROLES.map(r => (
                    <label key={r.value} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', background: form.role === r.value ? `${r.color}15` : 'var(--surface2)', border: `1.5px solid ${form.role === r.value ? r.color : 'var(--border)'}`, borderRadius: '10px', cursor: 'pointer', transition: 'all .15s' }}>
                      <input type="radio" name="role" value={r.value} checked={form.role === r.value} onChange={() => setForm({ ...form, role: r.value })} style={{ accentColor: r.color }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: '13px', color: form.role === r.value ? r.color : 'var(--text)' }}>{r.label}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '1px' }}>{r.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>อีเมล (สำหรับเข้าสู่ระบบ)</label>
                <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="user@example.com" disabled={!!editUser} />
              </div>
              <div className="form-group">
                <label>{editUser ? 'รหัสผ่านใหม่ (ว่าง = ไม่เปลี่ยน)' : 'รหัสผ่าน'}</label>
                <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="อย่างน้อย 6 ตัวอักษร" />
              </div>

              <div className="form-group">
                <label>เว็บที่เข้าถึงได้ (ว่าง = ทุกเว็บ)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {sites.map(s => (
                    <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', background: form.site_access.includes(s.name) ? 'rgba(108,99,255,.18)' : 'var(--surface2)', border: `1px solid ${form.site_access.includes(s.name) ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '20px', cursor: 'pointer', fontSize: '12px' }}>
                      <input type="checkbox" checked={form.site_access.includes(s.name)} onChange={e => setForm({ ...form, site_access: e.target.checked ? [...form.site_access, s.name] : form.site_access.filter(x => x !== s.name) })} style={{ display: 'none' }} />
                      {s.name}
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' }}>
                <button className="btn btn-outline" onClick={() => setShowModal(false)}>ยกเลิก</button>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving || (!editUser && (!form.full_name || !form.email || !form.password))}>{saving ? 'กำลังบันทึก...' : '💾 บันทึก'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast.msg && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  )
}
