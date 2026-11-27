import { subscribeToChannel } from './realtime.js'

export function subscribeToAuthorization(refresh) {
  return subscribeToChannel('account.authorization', { 'authorization.changed': refresh }, { onReconnected: refresh })
}
