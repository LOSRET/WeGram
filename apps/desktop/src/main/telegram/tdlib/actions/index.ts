/**
 * TDLib requests as functions over `ActionDeps`, grouped by what they act on:
 * the chat list/mute (`chats`), the address book (`contacts`), history paging
 * (`history`), downloads (`files`), sending and editing (`send`) and search
 * (`search`).
 *
 * `TdlibAdapter` is the only caller; keeping the groups apart means a change to
 * history paging never has to be reviewed against the send path.
 */
export * from './bots'
export * from './chats'
export * from './comments'
export * from './contacts'
export * from './deps'
export * from './files'
export * from './pins'
export * from './history'
export * from './notification-settings'
export * from './poll'
export * from './properties'
export * from './search'
export * from './send'
export * from './storage'
export * from './topics'
export * from './users'
export * from './web'
