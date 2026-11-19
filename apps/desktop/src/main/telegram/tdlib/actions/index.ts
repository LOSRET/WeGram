/**
 * TDLib requests as functions over `ActionDeps`, grouped by what they act on:
 * the chat list/mute (`chats`), history paging (`history`), downloads
 * (`files`), sending and editing (`send`) and search (`search`).
 *
 * `TdlibAdapter` is the only caller; keeping the groups apart means a change to
 * history paging never has to be reviewed against the send path.
 */
export * from './chats'
export * from './deps'
export * from './files'
export * from './history'
export * from './search'
export * from './send'
