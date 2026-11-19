import { CubeTabIcon, MomentsTabIcon } from './Icon'

/**
 * 收藏 and 朋友圈 are selectable rail sections, but the protocol carries no data
 * for either. Their tab still turns brand green like the client's does; this pane
 * then says the section is not wired instead of raising a toast that scrolls away.
 */
export function SectionPlaceholder({ section }: { section: 'favorites' | 'moments' }) {
  const Icon = section === 'favorites' ? CubeTabIcon : MomentsTabIcon
  return (
    <main className="wx-chat">
      <div className="wx-empty-chat">
        <Icon size={72} className="wx-empty-chat__glyph" />
        <div>{section === 'favorites' ? '收藏还没有接入' : '朋友圈还没有接入'}</div>
      </div>
    </main>
  )
}
