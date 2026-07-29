import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  RefreshCw, Plus, GripVertical, Pencil, X, LayoutGrid, ChevronLeft, Check,
  Loader2, Copy, Share2, Lock, Unlock, Eye, Palette,
} from 'lucide-react'
import { FileText, Image } from 'lucide-react'
import ShareModal from '../components/ShareModal'
import ThemeScope from '../components/ThemeScope'
import ThemeModal from '../components/ThemeModal'
import { widgetAccentVars } from '../theme'
import { useTheme } from '../useTheme'
import DashboardGrid from '../components/DashboardGrid'
import ExportMenu from '../components/ExportMenu'
import { dashboards, datasources, data as dataApi } from '../api'
import WidgetRenderer, { DataBadge } from '../components/WidgetRenderer'
import WidgetConfigModal from '../components/WidgetConfigModal'
import { layoutsEqual, minSizeFor, nextSlot, toGridItems, toStoredLayout } from '../layout'
import { downloadCsv, downloadPng } from '../export'
import { DEFAULT_RANGE, RANGES } from '../timeRange'
import { useAuth } from '../useAuth'

export default function DashboardEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const canEdit = can('dashboard.edit')
  const [theme] = useTheme()   // light or dark, so widget accents pick the right variant
  const [dashboard, setDashboard] = useState(null)
  const [sources, setSources] = useState([])
  const [modal, setModal] = useState(null) // null | {widget?} for add/edit
  const [refreshKey, setRefreshKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [statuses, setStatuses] = useState({})   // widgetId -> { meta, stale }
  const [themeOpen, setThemeOpen] = useState(false)
  const saveTimer = useRef(null)
  // latest fetched rows per widget, so CSV export doesn't re-query the source
  const widgetData = useRef({})
  const gridRef = useRef(null)

  useEffect(() => {
    dashboards.get(id).then((res) => setDashboard(res.data))
    // viewers can't list data sources; they don't need them since they can't edit
    if (canEdit) datasources.list().then((res) => setSources(res.data)).catch(() => {})
  }, [id, canEdit])

  // manual refresh must bypass the backend cache, so drop the cached responses
  // for every source this dashboard uses before re-fetching
  const forceRefresh = async () => {
    const ids = [...new Set((dashboard?.definition?.widgets || []).map((w) => w.datasource_id))]
    await Promise.allSettled(ids.map((dsId) => dataApi.invalidate(dsId)))
    setRefreshKey((k) => k + 1)
  }

  const persist = useCallback((definition) => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      await dashboards.update(id, { definition })
      setSaving(false)
    }, 600)
  }, [id])

  const updateDefinition = (updater) => {
    setDashboard((d) => {
      const definition = updater(d.definition)
      persist(definition)
      return { ...d, definition }
    })
  }

  const saveWidget = (widget) => {
    updateDefinition((def) => {
      const widgets = [...(def.widgets || [])]
      const layout = [...(def.layout || [])]
      const idx = widgets.findIndex((w) => w.id === widget.id)
      if (idx >= 0) {
        widgets[idx] = widget
      } else {
        widgets.push(widget)
        const min = minSizeFor(widget.type)
        const slot = nextSlot(layout)
        layout.push({ i: widget.id, ...slot, w: Math.max(slot.w, min.w), h: Math.max(slot.h, min.h) })
      }
      return { ...def, widgets, layout }
    })
    setModal(null)
  }

  const duplicateWidget = (widget) => {
    const copy = { ...widget, id: `w${Date.now()}`, title: `${widget.title} (copy)` }
    updateDefinition((def) => {
      const source = (def.layout || []).find((l) => l.i === widget.id)
      const slot = nextSlot(def.layout)
      return {
        ...def,
        widgets: [...def.widgets, copy],
        layout: [...(def.layout || []),
          { i: copy.id, x: slot.x, y: slot.y, w: source?.w || slot.w, h: source?.h || slot.h }],
      }
    })
  }

  const captureData = useCallback((widgetId, result, status = {}) => {
    if (result) widgetData.current[widgetId] = result
    // only re-render when the warning state actually changes, so a routine
    // auto-refresh doesn't churn the whole editor
    setStatuses((prev) => {
      const next = { meta: result?.meta, stale: Boolean(status.stale) }
      const old = prev[widgetId]
      if (old?.stale === next.stale && old?.meta?.partial === next.meta?.partial
        && old?.meta?.fetched === next.meta?.fetched) return prev
      return { ...prev, [widgetId]: next }
    })
  }, [])

  const setTimeRange = (key) => {
    updateDefinition((def) => ({ ...def, time_range: key }))
  }

  const widgetExports = (w) => [
    {
      key: 'csv',
      label: 'Download data (CSV)',
      Icon: FileText,
      run: () => {
        const result = widgetData.current[w.id]
        if (!result?.rows?.length) throw new Error('No data to export yet')
        downloadCsv(w.title, result.columns, result.rows)
      },
    },
    {
      key: 'png',
      label: 'Download image (PNG)',
      Icon: Image,
      run: () => downloadPng(
        document.querySelector(`[data-widget-id="${w.id}"]`), w.title),
    },
  ]

  const dashboardExports = [
    {
      key: 'png',
      label: 'Dashboard image (PNG)',
      Icon: Image,
      run: () => downloadPng(gridRef.current, dashboard.name),
    },
    {
      key: 'csv',
      label: 'All widget data (CSV)',
      Icon: FileText,
      run: () => {
        // one file per widget that has data — simpler than a merged sheet
        const ready = widgets.filter((w) => widgetData.current[w.id]?.rows?.length)
        if (!ready.length) throw new Error('No data to export yet')
        ready.forEach((w, i) => {
          const r = widgetData.current[w.id]
          // stagger so browsers don't block the burst of downloads
          setTimeout(() => downloadCsv(`${dashboard.name}-${w.title}`, r.columns, r.rows), i * 250)
        })
      },
    },
  ]

  const toggleLock = (widget) => {
    updateDefinition((def) => ({
      ...def,
      widgets: def.widgets.map((w) => (w.id === widget.id ? { ...w, locked: !w.locked } : w)),
    }))
  }

  const removeWidget = (widgetId) => {
    updateDefinition((def) => ({
      ...def,
      widgets: def.widgets.filter((w) => w.id !== widgetId),
      layout: (def.layout || []).filter((l) => l.i !== widgetId),
    }))
  }

  // gridstack reports geometry after a drag or resize settles
  const onLayoutChange = useCallback((gridItems) => {
    const layout = toStoredLayout(gridItems)
    setDashboard((d) => {
      if (!d || layoutsEqual(layout, d.definition.layout)) return d   // no-op, skip the save
      const definition = { ...d.definition, layout }
      persist(definition)
      return { ...d, definition }
    })
  }, [persist])

  const widgets = dashboard?.definition?.widgets || []
  const timeRange = dashboard?.definition?.time_range || DEFAULT_RANGE
  // only worth showing the range picker if something actually follows it
  const hasTimeSeries = widgets.some((w) => w.options?.follow_dashboard_range)
  const gridItems = useMemo(
    () => toGridItems(widgets, dashboard?.definition?.layout),
    [widgets, dashboard?.definition?.layout]
  )

  if (!dashboard) return <div className="page muted">Loading…</div>

  const renderWidget = (item) => {
    const w = item.widget
    return (
      <div className={item.locked ? 'widget locked' : 'widget'} data-widget-id={w.id}
        style={widgetAccentVars(w.options?.accent, theme)}>
        <div className={canEdit ? 'widget-header' : 'widget-header static'}
          title={canEdit ? (item.locked ? 'Locked — unlock to move' : 'Drag to move') : undefined}>
          {canEdit && <span className="grip"><GripVertical size={14} /></span>}
          <span className="title">{w.title}</span>
          <DataBadge meta={statuses[w.id]?.meta} stale={statuses[w.id]?.stale} />
          <span className="actions widget-actions">
            <ExportMenu compact actions={widgetExports(w)} label="Export widget" />
            {canEdit && (
              <>
                <button className={item.locked ? 'ghost small icon on' : 'ghost small icon'}
                  aria-label={item.locked ? 'Unlock widget' : 'Lock widget'}
                  aria-pressed={item.locked}
                  title={item.locked ? 'Unlock position and size' : 'Lock position and size'}
                  onClick={() => toggleLock(w)}>
                  {item.locked ? <Lock size={13} /> : <Unlock size={13} />}
                </button>
                <button className="ghost small icon" aria-label="Edit widget" title="Edit widget"
                  onClick={() => setModal({ widget: w })}>
                  <Pencil size={13} />
                </button>
                <button className="ghost small icon" aria-label="Duplicate widget" title="Duplicate widget"
                  onClick={() => duplicateWidget(w)}>
                  <Copy size={13} />
                </button>
                <button className="danger ghost small icon" aria-label="Remove widget" title="Remove widget"
                  onClick={() => removeWidget(w.id)}>
                  <X size={14} />
                </button>
              </>
            )}
          </span>
        </div>
        <div className="widget-body">
          <WidgetRenderer widget={w} refreshKey={refreshKey}
            dashboardRange={timeRange} onData={captureData}
            dashboardId={id} readOnly={!canEdit} />
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="editor-bar">
        <button className="ghost icon" aria-label="Back to dashboards" title="Back to dashboards"
          onClick={() => navigate('/')}>
          <ChevronLeft size={16} />
        </button>
        <h1>{dashboard.name}</h1>
        {canEdit ? (
          <span className="save-state">
            {saving
              ? <><Loader2 size={12} className="spin" /> Saving…</>
              : <><Check size={12} /> Saved</>}
          </span>
        ) : (
          <span className="status-pill"><Eye size={11} /> Read-only</span>
        )}
        <span className="spacer" />
        {hasTimeSeries && (
          <select className="range-picker" value={timeRange} aria-label="Dashboard time range"
            onChange={(e) => setTimeRange(e.target.value)}>
            {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        )}
        <ExportMenu actions={dashboardExports} />
        <button className="secondary small" onClick={forceRefresh}>
          <RefreshCw size={13} /> Refresh data
        </button>
        {canEdit && (
          <>
            <button className={dashboard.share_token ? 'small' : 'secondary small'}
              onClick={() => setSharing(true)}>
              <Share2 size={13} /> {dashboard.share_token ? 'Shared' : 'Share'}
            </button>
            <button className="secondary small" onClick={() => setThemeOpen(true)} title="Dashboard theme">
              <Palette size={13} />
            </button>
            <button className="small" onClick={() => setModal({})}>
              <Plus size={14} /> Add widget
            </button>
          </>
        )}
      </div>

      <div className="editor-body">
        {widgets.length === 0 && (
          <div className="empty-state">
            <LayoutGrid size={32} />
            <p>
              {!canEdit
                ? 'This dashboard has no widgets yet.'
                : sources.length === 0
                  ? 'No widgets yet. Add a data source first, then add widgets here.'
                  : 'No widgets yet. Click "Add widget" to start.'}
            </p>
          </div>
        )}

        <ThemeScope theme={dashboard.definition?.theme}>
          <div ref={gridRef}>
            <DashboardGrid
              items={gridItems}
              renderItem={renderWidget}
              onChange={onLayoutChange}
              readOnly={!canEdit}
            />
          </div>
        </ThemeScope>

        {themeOpen && (
          <ThemeModal
            theme={dashboard.definition?.theme}
            onChange={(next) => updateDefinition((def) => {
              const copy = { ...def }
              if (next) copy.theme = next
              else delete copy.theme
              return copy
            })}
            onClose={() => setThemeOpen(false)}
          />
        )}

        {sharing && (
          <ShareModal
            dashboard={dashboard}
            onChange={(updated) => setDashboard((d) => ({ ...d, share_token: updated.share_token }))}
            onClose={() => setSharing(false)}
          />
        )}

        {modal && (
          <WidgetConfigModal
            widget={modal.widget}
            sources={sources}
            onSave={saveWidget}
            onClose={() => setModal(null)}
          />
        )}
      </div>
    </>
  )
}
