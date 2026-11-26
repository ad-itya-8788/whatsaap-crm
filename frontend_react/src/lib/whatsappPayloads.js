export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

export function extractTemplateVariables(text) {
  const matches = String(text || '').match(/\{\{\s*(\d+)\s*\}\}/g) || []
  const indexes = matches
    .map((item) => Number(item.replace(/[^\d]/g, '')))
    .filter((value) => Number.isInteger(value) && value > 0)

  return [...new Set(indexes)].sort((left, right) => left - right)
}

export function renderTemplateBody(text, values = []) {
  return String(text || '').replace(/\{\{\s*(\d+)\s*\}\}/g, (match, index) => {
    const value = values[Number(index) - 1]
    return value === undefined || value === '' ? match : String(value)
  })
}

export function templateButtons(template) {
  return Array.isArray(template?.buttons) ? template.buttons : []
}

export function isApprovedTemplate(template) {
  const status = String(template?.approval_status || template?.status || '').toUpperCase()
  return status === 'APPROVED'
}

export function templateMessagePayload(template, values, idempotencyKey, replyToId) {
  const payload = {
    content_type: 'template',
    template_name: template.name,
    template_language: template.language,
    template_params: values.body,
    header_text: values.headerText,
    button_params: values.buttonParams,
    reply_to_message_id: replyToId,
    idempotency_key: idempotencyKey,
  }
  if (!values.headerFile) return payload

  const form = new FormData()
  for (const [key, value] of Object.entries(payload)) {
    if (value == null) continue
    if (typeof value === 'object') {
      for (const [index, entry] of Object.entries(value)) form.append(key + '[' + index + ']', entry)
    } else {
      form.append(key, value)
    }
  }
  form.append('header_file', values.headerFile)
  return form
}

export function blankButtonsPayload() {
  return {
    kind: 'buttons',
    body: '',
    header: '',
    footer: '',
    buttons: [
      { id: 'option_1', title: '' },
      { id: 'option_2', title: '' },
    ],
  }
}

export function blankListPayload() {
  return {
    kind: 'list',
    body: '',
    header: '',
    footer: '',
    button_label: 'View options',
    sections: [{ title: '', rows: [{ id: 'row_1', title: '' }] }],
  }
}

export function interactiveText(payload) {
  return String(payload?.body || payload?.content_text || '')
}
