import { useRef, useState } from 'react'
import api from '../../api/client.js'
import Icon from '../common/Icon.jsx'
import { useToast } from '../common/ToastProvider.jsx'
import { errorMessage } from '../../lib/utils.js'

const SUGGESTIONS = [
  'How should we follow up with a lead who went quiet?',
  'Write a short WhatsApp reminder for an upcoming appointment.',
  'Summarise our cancellation policy for a customer.',
]

export default function AiPlayground({ configured }) {
  const toast = useToast()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [tokens, setTokens] = useState(0)
  const endRef = useRef(null)

  const send = async (text = input) => {
    const content = text.trim()
    if (!content || busy) return

    const next = [...messages, { role: 'user', content }]
    setMessages(next)
    setInput('')
    setBusy(true)

    try {
      const { data } = await api.post('/api/app/ai/playground', { messages: next.map(({ role, content: body }) => ({ role, content: body })) })
      setMessages([...next, { role: 'assistant', content: data.content }])
      setTokens((current) => current + (data.usage?.total_tokens || 0))
      window.setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 30)
    } catch (error) {
      setMessages(next.slice(0, -1))
      setInput(content)
      toast.error(errorMessage(error, 'The AI request failed.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="agents-playground">
      <div className="agents-playground-head">
        <div>
          <h2>Playground</h2>
          <p>Test prompts safely with your saved provider and knowledge base.</p>
        </div>
        <span className="agents-pill"><Icon name="shield" size={14} /> Draft/answer only — nothing is sent</span>
      </div>

      {!configured && (
        <div className="agents-empty">
          <Icon name="bot" size={30} />
          <h3>AI is not configured yet</h3>
          <p>Open the Setup tab to add a provider key before using the playground.</p>
        </div>
      )}

      <div className="agents-chat">
        {!messages.length && (
          <div className="agents-chat-empty">
            <Icon name="bot" size={32} />
            <h3>Ask Aayojan AI anything</h3>
            <p>Answers use your saved instructions and knowledge documents.</p>
            <div className="agents-suggestions">
              {SUGGESTIONS.map((suggestion) => <button type="button" key={suggestion} onClick={() => send(suggestion)} disabled={!configured}>{suggestion}</button>)}
            </div>
          </div>
        )}
        {messages.map((message, index) => (
          <div className={`agents-message agents-message-${message.role}`} key={`${message.role}-${index}`}>
            <div className="agents-message-avatar">{message.role === 'assistant' ? <Icon name="bot" size={16} /> : 'You'}</div>
            <div className="agents-message-body">{message.content}</div>
          </div>
        ))}
        {busy && <div className="agents-message agents-message-assistant"><div className="agents-message-avatar"><Icon name="bot" size={16} /></div><div className="agents-message-body agents-typing">Thinking...</div></div>}
        <div ref={endRef} />
      </div>

      <form className="agents-chat-input" onSubmit={(event) => { event.preventDefault(); send() }}>
        <textarea className="composer-input" rows="2" value={input} onChange={(event) => setInput(event.target.value)} placeholder={configured ? 'Ask a question or paste a customer message...' : 'Configure AI first'} disabled={!configured || busy} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send() } }} />
        <button className="button button-primary" type="submit" disabled={!configured || busy || !input.trim()}><Icon name="send" size={16} /> {busy ? 'Sending...' : 'Ask AI'}</button>
      </form>
      <div className="agents-footnote">Session tokens: {tokens.toLocaleString()}</div>
    </div>
  )
}
