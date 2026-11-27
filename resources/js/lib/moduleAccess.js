export function hasModuleAccess(user, module) {
  return Boolean(user && (user.role === 'owner' || user.module_access?.includes(module)))
}

export function moduleForPath(user, url) {
  const path = url.split('?')[0]
  return Object.entries(user?.modules ?? {}).find(([, module]) =>
    path === module.path || path.startsWith(module.path + '/')
  )?.[0]
}
