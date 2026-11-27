import { Link, router } from '@inertiajs/react'
import { useEffect, useMemo, useState } from 'react'
import api from '../api/client.js'
import PageHeader from '../components/common/PageHeader.jsx'
import { useToast } from '../components/common/ToastProvider.jsx'
import { usePageLocation } from '../lib/navigation.js'
import { errorMessage } from '../lib/utils.js'

const root = '/api/app/authorization'
const newRole = { key: '', name: '', description: '', permissions: [] }

export default function AuthorizationPage() {
  const { searchParams } = usePageLocation()
  const memberId = searchParams.get('user')
  const toast = useToast()
  const [catalog, setCatalog] = useState(null)
  const [member, setMember] = useState(null)
  const [audit, setAudit] = useState(null)
  const [role, setRole] = useState(null)
  const [values, setValues] = useState({})
  const [original, setOriginal] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const signature = JSON.stringify([role?.name, role?.description, Object.entries(values).sort()])
  const dirty = Boolean(original && original !== signature)
  const protectedEditor = member?.protected || role?.key === 'owner'
  const registry = catalog?.registry
  const groups = useMemo(() => {
    const grouped = {}
    const keyword = search.trim().toLowerCase()
    for (const item of registry ?? []) {
      if (!item.owner_only || protectedEditor) {
        if ([item.module, item.label, item.key, item.description].some((part) => part.toLowerCase().includes(keyword))) {
          (grouped[item.module] ??= []).push(item)
        }
      }
    }
    return grouped
  }, [registry, search, protectedEditor])

  useEffect(() => {
    const controller = new AbortController()
    setCatalog(null)
    setMember(null)
    setRole(null)
    setAudit(null)
    setError('')
    setOriginal('')
    Promise.all([
      api.get(root, { signal: controller.signal }),
      memberId ? api.get(root + '/users/' + encodeURIComponent(memberId), { signal: controller.signal }) : null,
    ]).then(([catalogResponse, memberResponse]) => {
      if (controller.signal.aborted) return
      setCatalog(catalogResponse.data)
      if (memberResponse) {
        setMember(memberResponse.data)
        const overrides = memberResponse.data.overrides ?? {}
        setValues(overrides)
        setOriginal(JSON.stringify([undefined, undefined, Object.entries(overrides).sort()]))
      }
    }).catch((failure) => {
      if (!controller.signal.aborted) setError(errorMessage(failure, 'Unable to load authorization settings.'))
    })
    return () => controller.abort()
  }, [memberId])

  useEffect(() => {
    if (!dirty) return undefined
    const confirmLeave = () => window.confirm('Discard unsaved permission changes?')
    const removeListener = router.on('before', confirmLeave)
    const beforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      removeListener()
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [dirty])

  const selectRole = (next) => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    const selected = { ...next, description: next.description ?? '' }
    const permissions = Object.fromEntries(next.permissions.map((key) => [key, true]))
    setRole(selected)
    setValues(permissions)
    setOriginal(JSON.stringify([selected.name, selected.description, Object.entries(permissions).sort()]))
    setAudit(null)
  }

  const change = (items, value) => {
    setValues((current) => {
      const next = { ...current }
      for (const { key } of items) {
        if (value === undefined || (!member && value === false)) delete next[key]
        else next[key] = value
      }
      return next
    })
  }

  const save = async (event) => {
    event.preventDefault()
    if (busy || protectedEditor || !window.confirm('Apply these changes immediately?')) return
    setBusy(true)
    setError('')
    try {
      if (member) {
        await api.put(root + '/users/' + member.user.id, { overrides: values })
        const response = await api.get(root + '/users/' + member.user.id)
        setMember(response.data)
        setOriginal(signature)
      } else {
        const { key, name, description } = role
        const payload = { name, description, permissions: Object.keys(values) }
        const { data } = key ? await api.put(root + '/roles/' + key, payload) : await api.post(root + '/roles', payload)
        const updated = await api.get(root)
        setCatalog(updated.data)
        setRole({ ...role, key: data.key })
        setOriginal(signature)
      }
      toast.success('Access changes saved.')
    } catch (failure) {
      setError(errorMessage(failure, 'Unable to save access changes.'))
    } finally {
      setBusy(false)
    }
  }

  const deleteRole = async () => {
    if (!window.confirm('Delete this custom role?')) return
    try {
      await api.delete(root + '/roles/' + role.key)
      setCatalog((await api.get(root)).data)
      setRole(null)
      setOriginal('')
    } catch (failure) {
      setError(errorMessage(failure, 'Unable to delete this role.'))
    }
  }

  const loadAudit = async (page = 1) => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    try {
      const { data } = await api.get(root + '/audit', { params: { page } })
      setAudit(data)
      setRole(null)
      setOriginal('')
    } catch (failure) {
      setError(errorMessage(failure, 'Unable to load audit history.'))
    }
  }

  const inherited = new Set(member?.role_permissions ?? [])
  const effective = new Set(protectedEditor && member?.user.is_active !== false ? registry?.map(({ key }) => key) : [])
  if (!protectedEditor && (!member || member.user.is_active)) {
    let size
    do {
      size = effective.size
      for (const item of registry ?? []) {
        if ((values[item.key] ?? inherited.has(item.key)) && item.dependencies.every((key) => effective.has(key))) effective.add(item.key)
      }
    } while (size !== effective.size)
  }

  const assignable = registry?.filter(({ owner_only }) => !owner_only) ?? []
  return <>
    <PageHeader title={memberId ? 'Member permissions' : 'Roles & permissions'} />
    {error && <div className="alert alert-error" role="alert">{error}</div>}
    {!catalog && !error && <p role="status">Loading permissions...</p>}
    {catalog && !memberId && <>
      <section className="team-card">
        <div className="panel-header">
          <h2>Roles</h2>
          <div className="team-actions">
            <button className="button button-secondary" type="button" onClick={() => loadAudit()}>Audit history</button>
            <button className="button button-primary" type="button" onClick={() => selectRole(newRole)}>New role</button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Role</th><th>Members</th><th>Permissions</th><th>Actions</th></tr></thead>
            <tbody>{catalog.roles.map((item) => <tr key={item.key}>
              <td>{item.name}{item.description && <small className="muted"> {item.description}</small>}</td>
              <td><Link href={`/team?role=${encodeURIComponent(item.key)}`}>{item.users_count} <span className="visually-hidden">members with the {item.name} role</span></Link></td><td>{item.permissions.length}</td>
              <td><button type="button" className="button button-secondary button-sm" onClick={() => selectRole(item)}>{item.key === 'owner' ? 'View' : 'Edit'}</button></td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>
      {audit && <section className="team-card">
        <h2>Authorization history</h2>
        {!audit.data.length && <p>No authorization changes have been recorded.</p>}
        {audit.data.map((entry) => <details key={entry.id}>
          <summary>{entry.created_at} | {entry.action} | {entry.subject} | Actor {entry.actor_id ?? 'deleted'}</summary>
          <pre>{JSON.stringify({ previous: JSON.parse(entry.previous ?? 'null'), updated: JSON.parse(entry.updated ?? 'null') }, null, 2)}</pre>
        </details>)}
        {audit.current_page > 1 && <button type="button" className="button" onClick={() => loadAudit(audit.current_page - 1)}>Previous</button>}
        {audit.current_page < audit.last_page && <button type="button" className="button" onClick={() => loadAudit(audit.current_page + 1)}>Next</button>}
      </section>}
    </>}
    {(member || role) && <form className="team-card team-form" onSubmit={save}>
      <h2>{member ? member.user.name : role.key ? role.name : 'New custom role'}</h2>
      {member?.user.avatar_url && <img className="avatar" alt="" src={member.user.avatar_url.startsWith('/') ? member.user.avatar_url : '/storage/' + member.user.avatar_url} />}
      {member && <p>{member.user.email} | {catalog.roles.find(({ key }) => key === member.user.role)?.name ?? member.user.role} | {member.user.is_active ? 'Active' : 'Inactive'}</p>}
      {role && !protectedEditor && <div className="form-grid">
        <label className="field">Role name<input className="input" required maxLength={100} value={role.name} onChange={(event) => setRole({ ...role, name: event.target.value })} /></label>
        <label className="field">Description<input className="input" maxLength={1000} value={role.description} onChange={(event) => setRole({ ...role, description: event.target.value })} /></label>
      </div>}
      {protectedEditor && <p>Owner access is protected and includes every permission.</p>}
      <p aria-live="polite">{effective.size} effective of {registry.length} available{member && ` | ${Object.values(values).filter((value) => value === true).length} explicit grants | ${Object.values(values).filter((value) => value === false).length} explicit denials`}</p>
      <label className="field">Search permissions<input className="input" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <div className="team-actions">
        <button type="button" className="button button-secondary" onClick={() => setExpanded(Object.fromEntries(Object.keys(groups).map((key) => [key, true])))}>Expand all</button>
        <button type="button" className="button button-secondary" onClick={() => setExpanded({})}>Collapse all</button>
        {!protectedEditor && <>
          <button type="button" className="button button-secondary" onClick={() => change(assignable, true)}>Grant all</button>
          <button type="button" className="button button-secondary" onClick={() => change(assignable, false)}>Revoke all</button>
          {member && <button type="button" className="button button-secondary" onClick={() => { if (window.confirm('Reset all overrides to role defaults?')) setValues({}) }}>Reset to role defaults</button>}
        </>}
      </div>
      {!Object.keys(groups).length && <p>No permissions match your search.</p>}
      {Object.entries(groups).map(([module, items]) => <details className="team-card" key={module} open={Boolean(expanded[module])} onToggle={(event) => {
        const open = event.currentTarget.open
        if (Boolean(expanded[module]) !== open) setExpanded((current) => ({ ...current, [module]: open }))
      }}>
        <summary>{module} ({items.filter(({ key }) => effective.has(key)).length}/{items.length})</summary>
        {!protectedEditor && <div className="team-actions">
          <button type="button" className="button button-secondary button-sm" onClick={() => change(items, true)}>Select all</button>
          <button type="button" className="button button-secondary button-sm" onClick={() => change(items, false)}>Deselect all</button>
        </div>}
        {items.map((item) => {
          const value = values[item.key]
          const missing = item.dependencies.filter((key) => !effective.has(key))
          return <label key={item.key} className="field">
            <span>{item.label} <small className="muted">{effective.has(item.key) ? 'Granted' : 'Denied'}{!effective.has(item.key) && missing.length > 0 && ` | Requires ${missing.join(', ')}`}</small></span>
            <small>{item.description}</small>
            {!protectedEditor && (member
              ? <select className="select" value={value === undefined ? 'inherit' : String(value)} onChange={(event) => change([item], event.target.value === 'inherit' ? undefined : event.target.value === 'true')}>
                <option value="inherit">Inherit ({inherited.has(item.key) ? 'allow' : 'deny'})</option><option value="true">Allow</option><option value="false">Deny</option>
              </select>
              : <input type="checkbox" checked={value === true} onChange={(event) => change([item], event.target.checked)} />)}
          </label>
        })}
      </details>)}
      {!protectedEditor && <div className="team-actions">
        <button className="button button-primary" disabled={busy || !dirty}>{busy ? 'Saving...' : 'Save changes'}</button>
        <button type="button" className="button button-secondary" disabled={!dirty} onClick={() => {
          const [name, description, permissions] = JSON.parse(original)
          if (role) setRole({ ...role, name, description })
          setValues(Object.fromEntries(permissions))
        }}>Cancel changes</button>
        {role?.key && !catalog.roles.find((item) => item.key === role.key)?.built_in && <button type="button" className="button button-danger" onClick={deleteRole}>Delete role</button>}
      </div>}
    </form>}
  </>
}
