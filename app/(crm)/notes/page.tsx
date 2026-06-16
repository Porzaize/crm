'use client'
// Required table:
// CREATE TABLE team_notes (
//   id serial PRIMARY KEY,
//   title text NOT NULL,
//   content text NOT NULL,
//   category text DEFAULT 'general',
//   pinned boolean DEFAULT false,
//   created_by uuid REFERENCES auth.users(id),
//   author_name text,
//   created_at timestamptz DEFAULT now(),
//   updated_at timestamptz DEFAULT now()
// );

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'

interface Note {
  id: number
  title: string
  content: string
  category: string
  pinned: boolean
  created_by: string
  author_name: string
  created_at: string
  updated_at: string
}

const CATEGORIES = [
  { key: 'all', label: 'ทั้งหมด', icon: '' },
  { key: 'announcement', label: 'ประกาศ', icon: '📢' },
  { key: 'promotion', label: 'โปรโมชั่น', icon: '🎁' },
  { key: 'warning', label: 'เตือน', icon: '⚠️' },
  { key: 'general', label: 'ทั่วไป', icon: '📝' },
]

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  announcement: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  promotion: { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
  warning: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
  general: { bg: '#f3f4f6', text: '#374151', border: '#d1d5db' },
}

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState('')
  const [userId, setUserId] = useState('')
  const [activeTab, setActiveTab] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [category, setCategory] = useState('general')
  const [toast, setToast] = useState({ msg: '', type: '' })
  const [editingId, setEditingId] = useState<number | null>(null)
  const supabase = createClient()

  useEffect(() => {
    loadRole()
    loadNotes()
  }, [])

  async function loadRole() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)
    const saved = localStorage.getItem('impersonate_role')
    const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', user.id).single()
    const real = profile?.role || user.user_metadata?.role || ''
    if (saved && (real === 'manager' || real === 'admin')) setUserRole(saved)
    else setUserRole(real)
  }

  async function loadNotes() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('team_notes')
        .select('*')
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      setNotes(data || [])
    } catch {
      // Table might not exist yet - show empty state
      setNotes([])
    }
    setLoading(false)
  }

  async function handleAdd() {
    if (!title.trim() || !content.trim()) {
      showToast('กรุณากรอกหัวข้อและเนื้อหา', 'error')
      return
    }
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const authorName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || 'ไม่ระบุ'

    const { error } = await supabase.from('team_notes').insert({
      title: title.trim(),
      content: content.trim(),
      category,
      pinned: false,
      created_by: user?.id,
      author_name: authorName,
    })

    if (error) {
      showToast('ไม่สามารถเพิ่มโน้ตได้ (ตรวจสอบตาราง team_notes)', 'error')
    } else {
      showToast('เพิ่มโน้ตสำเร็จ', 'success')
      setTitle('')
      setContent('')
      setCategory('general')
      setShowForm(false)
      loadNotes()
    }
    setSaving(false)
  }

  async function handleDelete(id: number) {
    if (!confirm('ต้องการลบโน้ตนี้?')) return
    const { error } = await supabase.from('team_notes').delete().eq('id', id)
    if (error) {
      showToast('ลบไม่สำเร็จ', 'error')
    } else {
      showToast('ลบโน้ตสำเร็จ', 'success')
      loadNotes()
    }
  }

  async function handleTogglePin(id: number, currentPinned: boolean) {
    const { error } = await supabase
      .from('team_notes')
      .update({ pinned: !currentPinned, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      showToast('อัปเดตไม่สำเร็จ', 'error')
    } else {
      loadNotes()
    }
  }

  function startEdit(note: Note) {
    setEditingId(note.id)
    setTitle(note.title)
    setContent(note.content)
    setCategory(note.category)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId(null)
    setTitle('')
    setContent('')
    setCategory('general')
    setShowForm(false)
  }

  async function handleUpdate() {
    if (!editingId) return
    if (!title.trim() || !content.trim()) {
      showToast('กรุณากรอกหัวข้อและเนื้อหา', 'error')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('team_notes').update({
      title: title.trim(),
      content: content.trim(),
      category,
      updated_at: new Date().toISOString(),
    }).eq('id', editingId)

    if (error) {
      showToast('แก้ไขไม่สำเร็จ', 'error')
    } else {
      showToast('แก้ไขโน้ตสำเร็จ', 'success')
      cancelEdit()
      loadNotes()
    }
    setSaving(false)
  }

  function showToast(msg: string, type: string) {
    setToast({ msg, type })
    setTimeout(() => setToast({ msg: '', type: '' }), 3000)
  }

  const isAdmin = userRole === 'admin' || userRole === 'manager'
  const canAdd = userRole !== 'viewer'
  const filteredNotes = activeTab === 'all' ? notes : notes.filter(n => n.category === activeTab)

  function formatDate(dateStr: string) {
    const d = new Date(dateStr)
    return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  function getCategoryInfo(cat: string) {
    const found = CATEGORIES.find(c => c.key === cat)
    return found || { key: cat, label: cat, icon: '📝' }
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* Topbar */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '13px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50 }}>
        <div>
          <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>📋 โน้ตทีม & ประกาศ</h2>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>บันทึกข้อความ ประกาศ และแจ้งเตือนสำหรับทีม</p>
        </div>
        {canAdd && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? '✕ ปิดฟอร์ม' : '＋ เพิ่มโน้ต'}
          </button>
        )}
      </div>

      {/* Toast */}
      {toast.msg && (
        <div style={{
          position: 'fixed', top: '20px', right: '20px', zIndex: 999,
          padding: '12px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
          background: toast.type === 'success' ? '#dcfce7' : '#fee2e2',
          color: toast.type === 'success' ? '#166534' : '#991b1b',
          border: `1px solid ${toast.type === 'success' ? '#86efac' : '#fca5a5'}`,
          boxShadow: '0 4px 12px rgba(0,0,0,.1)',
        }}>
          {toast.type === 'success' ? '✓' : '✕'} {toast.msg}
        </div>
      )}

      <div style={{ padding: '20px 24px', maxWidth: '900px', margin: '0 auto' }}>
        {/* Add Note Form */}
        {showForm && canAdd && (
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px',
            padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,.06)',
          }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', marginBottom: '16px' }}>{editingId ? '✏️ แก้ไขโน้ต' : 'เพิ่มโน้ตใหม่'}</h3>

            <div className="form-group" style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text2)', marginBottom: '6px' }}>หัวข้อ</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="หัวข้อโน้ต..."
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: '8px',
                  border: '1px solid var(--border)', fontSize: '13px',
                  background: 'var(--bg)', color: 'var(--text)',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>

            <div className="form-group" style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text2)', marginBottom: '6px' }}>เนื้อหา</label>
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="รายละเอียด..."
                rows={4}
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: '8px',
                  border: '1px solid var(--border)', fontSize: '13px',
                  background: 'var(--bg)', color: 'var(--text)',
                  outline: 'none', resize: 'vertical', boxSizing: 'border-box',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text2)', marginBottom: '6px' }}>หมวดหมู่</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: '8px',
                  border: '1px solid var(--border)', fontSize: '13px',
                  background: 'var(--bg)', color: 'var(--text)',
                  outline: 'none', boxSizing: 'border-box',
                }}
              >
                {CATEGORIES.filter(c => c.key !== 'all').map(c => (
                  <option key={c.key} value={c.key}>{c.icon} {c.label}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn btn-outline btn-sm" onClick={cancelEdit}>
                ยกเลิก
              </button>
              <button className="btn btn-primary btn-sm" onClick={editingId ? handleUpdate : handleAdd} disabled={saving}>
                {saving ? 'กำลังบันทึก...' : editingId ? '💾 บันทึกการแก้ไข' : 'บันทึกโน้ต'}
              </button>
            </div>
          </div>
        )}

        {/* Category Tabs */}
        <div style={{
          display: 'flex', gap: '6px', marginBottom: '20px', flexWrap: 'wrap',
        }}>
          {CATEGORIES.map(c => (
            <button
              key={c.key}
              onClick={() => setActiveTab(c.key)}
              style={{
                padding: '6px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 500,
                border: '1px solid',
                borderColor: activeTab === c.key ? 'var(--accent)' : 'var(--border)',
                background: activeTab === c.key ? 'var(--accent)' : 'var(--surface)',
                color: activeTab === c.key ? '#fff' : 'var(--text2)',
                cursor: 'pointer', transition: 'all .15s',
              }}
            >
              {c.icon ? `${c.icon} ` : ''}{c.label}
              {c.key !== 'all' && (
                <span style={{ marginLeft: '4px', opacity: 0.7 }}>
                  ({notes.filter(n => n.category === c.key).length})
                </span>
              )}
              {c.key === 'all' && (
                <span style={{ marginLeft: '4px', opacity: 0.7 }}>
                  ({notes.length})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text3)', justifyContent: 'center', height: '200px' }}>
            <div className="spinner" /> กำลังโหลด...
          </div>
        )}

        {/* Notes List */}
        {!loading && filteredNotes.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '60px 20px',
            background: 'var(--surface)', borderRadius: '12px',
            border: '1px solid var(--border)',
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📭</div>
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)', marginBottom: '8px' }}>
              ยังไม่มีโน้ต
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text3)', lineHeight: 1.6 }}>
              {activeTab !== 'all'
                ? `ยังไม่มีโน้ตในหมวด "${getCategoryInfo(activeTab).label}"`
                : 'เริ่มเพิ่มโน้ตหรือประกาศสำหรับทีมของคุณ'}
            </p>
            {canAdd && activeTab === 'all' && (
              <button
                className="btn btn-primary btn-sm"
                style={{ marginTop: '16px' }}
                onClick={() => setShowForm(true)}
              >
                ＋ เพิ่มโน้ตแรก
              </button>
            )}
          </div>
        )}

        {!loading && filteredNotes.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {filteredNotes.map(note => {
              const catColors = CATEGORY_COLORS[note.category] || CATEGORY_COLORS.general
              const catInfo = getCategoryInfo(note.category)

              return (
                <div
                  key={note.id}
                  style={{
                    background: 'var(--surface)',
                    border: note.pinned ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                    borderRadius: '12px',
                    padding: '16px 20px',
                    boxShadow: note.pinned ? '0 2px 8px rgba(108,99,255,.12)' : '0 1px 3px rgba(0,0,0,.06)',
                    position: 'relative',
                  }}
                >
                  {/* Pin indicator */}
                  {note.pinned && (
                    <div style={{
                      position: 'absolute', top: '-1px', right: '16px',
                      background: 'var(--accent)', color: '#fff',
                      padding: '2px 10px 4px', borderRadius: '0 0 6px 6px',
                      fontSize: '11px', fontWeight: 600,
                    }}>
                      📌 ปักหมุด
                    </div>
                  )}

                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                        <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', margin: 0 }}>
                          {note.title}
                        </h3>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: '10px',
                          fontSize: '11px', fontWeight: 500,
                          background: catColors.bg, color: catColors.text,
                          border: `1px solid ${catColors.border}`,
                        }}>
                          {catInfo.icon} {catInfo.label}
                        </span>
                      </div>
                      <p style={{
                        fontSize: '13px', color: 'var(--text2)', lineHeight: 1.7, margin: 0,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      }}>
                        {note.content}
                      </p>
                    </div>
                  </div>

                  {/* Footer */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--border)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px', color: 'var(--text3)' }}>
                      <span>👤 {note.author_name || 'ไม่ระบุ'}</span>
                      <span>🕐 {formatDate(note.created_at)}</span>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {(isAdmin || note.created_by === userId) && (
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => startEdit(note)}
                          style={{ fontSize: '11px', padding: '3px 8px' }}
                        >
                          ✏️ แก้ไข
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => handleTogglePin(note.id, note.pinned)}
                          style={{ fontSize: '11px', padding: '3px 8px' }}
                          title={note.pinned ? 'เลิกปักหมุด' : 'ปักหมุด'}
                        >
                          {note.pinned ? '📌 เลิกปักหมุด' : '📌 ปักหมุด'}
                        </button>
                      )}
                      {(isAdmin || note.created_by === userId) && (
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDelete(note.id)}
                          style={{ fontSize: '11px', padding: '3px 8px' }}
                        >
                          🗑 ลบ
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
