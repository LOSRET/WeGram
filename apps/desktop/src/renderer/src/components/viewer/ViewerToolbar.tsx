import { MoreIcon } from '../WechatIcons'
import {
  ActualSizeIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  GridIcon,
  PinIcon,
  RotateIcon,
  SaveIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from './ViewerIcons'

export interface ViewerToolbarProps {
  video: boolean
  pinned: boolean
  grid: boolean
  index: number
  count: number
  onPin: () => void
  onPrev: () => void
  onNext: () => void
  onToggleGrid: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onActualSize: () => void
  onRotate: () => void
  onSave: () => void
  onMenu: (x: number, y: number) => void
}

/**
 * The viewer's title strip: the toolbar takes the place of the window caption
 * (design doc §9.5), so every control lives here and the canvas keeps a plain
 * surface.
 */
export function ViewerToolbar({
  video,
  pinned,
  grid,
  index,
  count,
  onPin,
  onPrev,
  onNext,
  onToggleGrid,
  onZoomIn,
  onZoomOut,
  onActualSize,
  onRotate,
  onSave,
  onMenu,
}: ViewerToolbarProps) {
  return (
    <div className="wx-viewer__bar">
      <button
        type="button"
        className={`wx-viewer__icon${pinned ? ' is-active' : ''}`}
        title={pinned ? '取消置顶' : '置顶'}
        aria-pressed={pinned}
        onClick={onPin}
      >
        <PinIcon />
      </button>
      <span className="wx-viewer__sep" />
      <button
        type="button"
        className="wx-viewer__icon"
        title="上一张"
        disabled={index <= 0}
        onClick={onPrev}
      >
        <ArrowLeftIcon />
      </button>
      <button
        type="button"
        className="wx-viewer__icon"
        title="下一张"
        disabled={index >= count - 1}
        onClick={onNext}
      >
        <ArrowRightIcon />
      </button>
      <button
        type="button"
        className={`wx-viewer__icon${grid ? ' is-active' : ''}`}
        title="预览"
        aria-pressed={grid}
        onClick={onToggleGrid}
      >
        <GridIcon />
      </button>
      <span className="wx-viewer__sep" />
      {/* A video has nothing to zoom or rotate: the client's video strip is
          pin ｜ ← → ▦ ｜ ⇩ ｜ … ｜ window controls, exactly this. */}
      {video ? null : (
        <>
          <button type="button" className="wx-viewer__icon" title="放大" onClick={onZoomIn}>
            <ZoomInIcon />
          </button>
          <button type="button" className="wx-viewer__icon" title="缩小" onClick={onZoomOut}>
            <ZoomOutIcon />
          </button>
          <button type="button" className="wx-viewer__icon" title="图片原始大小" onClick={onActualSize}>
            <ActualSizeIcon />
          </button>
          <span className="wx-viewer__sep" />
          <button type="button" className="wx-viewer__icon" title="旋转" onClick={onRotate}>
            <RotateIcon />
          </button>
          <span className="wx-viewer__sep" />
        </>
      )}
      <button type="button" className="wx-viewer__icon" title="保存" onClick={onSave}>
        <SaveIcon />
      </button>
      <span className="wx-viewer__grow" />
      <button
        type="button"
        className="wx-viewer__icon"
        title="更多"
        aria-haspopup="menu"
        onClick={(event) => onMenu(event.clientX, event.clientY)}
      >
        <MoreIcon size={19} />
      </button>
    </div>
  )
}
