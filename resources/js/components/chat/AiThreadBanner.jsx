import { useEffect, useState } from 'react'
import api from '../../api/client.js'
import { errorMessage } from '../../lib/utils.js'
import Icon from '../common/Icon.jsx'
import { useToast } from '../common/ToastProvider.jsx'

export default function AiThreadBanner({ conversation, readOnly, onChange }) {
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const paused = conversation.ai_autoreply_disabled

  useEffect(() => {
    const controller = new AbortController()
    api.get('/api/app/ai/config', { signal: controller.signal })
      .then(({ data }) => {
        if (!controller.signal.aborted) setEnabled(Boolean(data.is_active && data.auto_reply_enabled))
      })
      .catch(() => {
        if (!controller.signal.aborted) setEnabled(false)
      })
    return () => controller.abort()
  }, [])

  const change = async () => {
    setBusy(true)
    try {
      const { data } = await api.post(`/api/app/conversations/${conversation.id}/ai-autoreply`, {
        paused: !paused,
        assign_to_me: !paused,
      })
      onChange(data)
      toast.success(paused ? 'AI auto-reply resumed.' : 'You took over the conversation.')
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to update AI auto-reply.'))
    } finally {
      setBusy(false)
    }
  }

  if (!enabled || (!paused && conversation.assigned_agent_id)) return null

  return (
    <div className={`ai-thread-banner${paused ? ' is-paused' : ''}`}>
      <Icon name="bolt" size={15} />
      <div>
        <strong>{paused ? 'AI auto-reply is paused' : 'AI auto-reply is enabled'}</strong>
        {paused && conversation.ai_handoff_summary && <div>{conversation.ai_handoff_summary}</div>}
      </div>
      {!readOnly && <button type="button" className="button button-sm button-secondary" onClick={change} disabled={busy}>
        {paused ? 'Resume AI' : 'Take over'}
      </button>}
    </div>
  )
}
