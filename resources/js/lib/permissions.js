export const pagePermissions = {
  '/dashboard': ['dashboard.view'], '/inbox': ['inbox.view'],
  '/notifications': ['notifications.view'], '/contacts': ['contacts.view'],
  '/broadcasts': ['broadcasts.view'], '/agents': ['ai.view'],
  '/workspace': ['tags.view', 'custom_fields.view', 'quick_replies.view'],
  '/templates': ['templates.view'], '/reports': ['reports.view'], '/team': ['users.view'],
  '/settings': ['account.profile', 'account.password', 'account.sessions', 'inbox_settings.view', 'whatsapp.view', 'api_keys.view', 'tags.view', 'custom_fields.view'],
  '/access': ['roles.manage'],
}

export function permissionsForPath(path) {
  if (path === '/broadcasts/new') return ['broadcasts.create']
  if (path.startsWith('/broadcasts/')) return ['broadcasts.recipients']
  if (path === '/templates/create') return ['templates.create']
  if (path.startsWith('/templates/')) return ['templates.update']
  return pagePermissions[path] ?? []
}

export function firstAccessiblePage(user) {
  return Object.keys(pagePermissions).find((path) =>
    pagePermissions[path].some((permission) => user?.permissions?.includes(permission))
  ) ?? '/dashboard'
}
