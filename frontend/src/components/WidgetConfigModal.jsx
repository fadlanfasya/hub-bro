import { useState } from 'react'
import {
  X, Plus, ChevronDown, ChevronRight, AlignLeft, AlignCenter, AlignRight,
} from 'lucide-react'
import { TONES } from '../tableRules'
import { templateColumns } from '../links'
import { Eye } from 'lucide-react'
import WidgetPreviewModal from './WidgetPreviewModal'
import { useModalMotion } from '../useModalMotion'

/** A collapsible sub-section, matching the existing "Filter & summarize" pattern —
 * closed by default unless it already holds a value, so editing an existing
 * widget doesn't hide settings that are actually in use. */
function Section({ title, open, onToggle, active, children }) {
  return (
    <>
      <div className="section-toggle">
        <button type="button" className="link" onClick={onToggle}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {title}
          {active && !open && <span className="dot" />}
        </button>
      </div>
      {open && <div className="subsection">{children}</div>}
    </>
  )
}

export default function WidgetConfigModal({
  widget, sources, onSave, onClose, dashboardList = [], currentDashboardId,
  // columns from this widget's most recent fetch, when it has one — lets the
  // form flag a mistyped {placeholder} instead of leaving it to the dashboard
  availableColumns = [],
}) {
  const { overlayRef, boxRef, requestClose } = useModalMotion(onClose)
  const [title, setTitle] = useState(widget?.title || '')
  const [type, setType] = useState(widget?.type || 'line')
  const [datasourceId, setDatasourceId] = useState(widget?.datasource_id || sources[0]?.id || '')
  const [opts, setOpts] = useState(widget?.options || {})

  const [colsText, setColsText] = useState((widget?.options?.columns || []).join(', '))
  const [barsText, setBarsText] = useState((widget?.options?.bar_columns || []).join(', '))
  const [renameText, setRenameText] = useState(
    Object.entries(widget?.options?.rename || {}).map(([k, v]) => `${k}=${v}`).join(', ')
  )

  const [filters, setFilters] = useState(
    widget?.options?.filters?.length
      ? widget.options.filters
      : [{ column: '', op: 'eq', value: '' }]
  )
  const [columnLinksText, setColumnLinksText] = useState(
    Object.entries(widget?.options?.column_links || {})
      .map(([col, url]) => `${col} = ${url}`).join('\n')
  )
  const [unpivotText, setUnpivotText] = useState(
    (widget?.options?.unpivot?.columns || []).join(', ')
  )
  const [error, setError] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(widget?.options?.group_by || widget?.options?.filters?.length
      || widget?.options?.sort || widget?.options?.unpivot)
  )
  const [showStatTrend, setShowStatTrend] = useState(
    Boolean(widget?.options?.compare_field !== undefined || widget?.options?.compare_mode)
  )
  const [showStatExtras, setShowStatExtras] = useState(
    Boolean(widget?.options?.percent_of || widget?.options?.sparkline || widget?.options?.detail)
  )
  const [showThresholds, setShowThresholds] = useState(Boolean(
    widget?.options?.thresholds?.warn || widget?.options?.thresholds?.critical
      || widget?.options?.prefix || widget?.options?.suffix
      || (widget?.options?.decimals ?? '') !== '' || widget?.options?.compact
      || widget?.options?.thousands === false
      || (widget?.options?.aggregate && widget?.options?.aggregate !== 'last')
  ))
  const [showTableStyling, setShowTableStyling] = useState(Boolean(
    widget?.options?.color_rules?.length || widget?.options?.column_format?.length
      || widget?.options?.bar_columns?.length
  ))

  const source = sources.find((s) => s.id === Number(datasourceId))
  const setOpt = (k, v) => setOpts((o) => ({ ...o, [k]: v }))

  /** Patch one count_by bucket, leaving the others alone. */
  const setBucket = (index, patch) => setOpts((o) => ({
    ...o,
    count_by: {
      ...(o.count_by || {}),
      buckets: (o.count_by?.buckets || []).map((b, i) => (i === index ? { ...b, ...patch } : b)),
    },
  }))

  /** Patch one date_diff entry, leaving the others alone. */
  const setDateDiff = (index, patch) => setOpts((o) => ({
    ...o,
    date_diff: (o.date_diff || []).map((d, i) => (i === index ? { ...d, ...patch } : d)),
  }))
  const setFilter = (i, patch) =>
    setFilters((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const setRule = (i, patch) =>
    setOpt('color_rules', (opts.color_rules || []).map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const setFormat = (i, patch) =>
    setOpt('column_format', (opts.column_format || []).map((f, j) => (j === i ? { ...f, ...patch } : f)))
  const setQuery = (i, patch) =>
    setOpt('queries', (opts.queries || []).map((q, j) => (j === i ? { ...q, ...patch } : q)))

  const save = (e) => {
    e.preventDefault()
    setError('')
    if (type !== 'text' && !datasourceId) return
    const rename = {}
    for (const pair of renameText.split(',')) {
      const idx = pair.indexOf('=')
      if (idx > 0) rename[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
    }
    if (Object.keys(rename).length) opts.rename = rename
    else delete opts.rename
    const cols = colsText.split(',').map((c) => c.trim()).filter(Boolean)
    if (cols.length) opts.columns = cols
    else delete opts.columns

    const bars = barsText.split(',').map((c) => c.trim()).filter(Boolean)
    if (bars.length) opts.bar_columns = bars
    else { delete opts.bar_columns; delete opts.bar_max }

    // A half-typed query row would break the widget, so blank rows are dropped.
    // A missing join key is different: the queries are real work, so say so
    // and keep the form open rather than quietly throwing them away.
    const queries = (opts.queries || []).filter((q) => q.query?.trim())
    if (queries.length) {
      if (!opts.join?.on?.trim()) {
        setError('Fill in "Join on" — the label that matches rows across your queries, '
          + 'usually instance.')
        return
      }
      opts.queries = queries.map((q, i) => ({ ...q, as: q.as?.trim() || `Query ${i + 1}` }))
      opts.join = { ...opts.join, on: opts.join.on.trim() }
      delete opts.query
    } else {
      delete opts.queries
      delete opts.join
    }

    const unpivotColumns = unpivotText.split(',').map((c) => c.trim()).filter(Boolean)
    if (unpivotColumns.length) opts.unpivot = { columns: unpivotColumns, name: 'name', value: 'value' }
    else delete opts.unpivot

    // transforms: drop incomplete entries so the backend doesn't receive noise
    const cleanFilters = filters.filter((f) => f.column.trim() &&
      (f.op === 'not_empty' || String(f.value).trim() !== ''))
    if (cleanFilters.length) opts.filters = cleanFilters
    else delete opts.filters
    if (!opts.group_by) { delete opts.group_by; delete opts.value_column }
    if (!opts.sort?.column) delete opts.sort
    if (!opts.limit) delete opts.limit
    // drop blank formatting options so a widget's saved options stay readable.
    // `label` is excluded on purpose: an empty string means "hide the label".
    for (const key of ['prefix', 'suffix', 'decimals', 'value_size', 'font_size']) {
      if (opts[key] === '' || opts[key] === null || opts[key] === undefined) delete opts[key]
    }
    if (opts.thousands !== false) delete opts.thousands   // true is the default
    if (!opts.compact) delete opts.compact
    if (!opts.pie_labels || opts.pie_labels === 'value') delete opts.pie_labels
    if (!opts.pie_style || opts.pie_style === 'donut') delete opts.pie_style
    if (opts.pie_center !== false) delete opts.pie_center
    if (!opts.pie_center_label) delete opts.pie_center_label
    const links = {}
    for (const line of columnLinksText.split('\n')) {
      const idx = line.indexOf('=')
      if (idx <= 0) continue
      const column = line.slice(0, idx).trim()
      const url = line.slice(idx + 1).trim()
      if (column && url) links[column] = url
    }
    if (Object.keys(links).length) opts.column_links = links
    else delete opts.column_links

    if (!opts.link || opts.link === 'https://') { delete opts.link; delete opts.link_label }
    if (!opts.link_label) delete opts.link_label
    if (!opts.accent) { delete opts.accent; delete opts.widget_bg }
    if (!opts.widget_bg || opts.widget_bg === 'none') delete opts.widget_bg
    if (opts.show_filters !== false) delete opts.show_filters   // shown by default
    if (!opts.align || opts.align === 'left') delete opts.align
    // vertical default differs by type: a stat sits centred, text starts at the top
    const defaultValign = type === 'text' ? 'top' : 'middle'
    if (!opts.valign || opts.valign === defaultValign) delete opts.valign

    // drop an empty threshold object so widgets without alerts stay clean
    const t = opts.thresholds
    if (!t || (t.warn === '' || t.warn == null) && (t.critical === '' || t.critical == null)) {
      delete opts.thresholds
    }
    // a text widget renders its own content, so it has no data source
    // Don't store a spec that can't do anything. A widget duplicated from
    // another carries the original's count_by and unpivot, and an empty one
    // used to sit in the saved dashboard looking harmless — until a path that
    // reads the stored options rather than the filtered ones tripped over it.
    if (!opts.count_by?.column?.trim() || !opts.count_by?.buckets?.length) {
      delete opts.count_by
    }
    if (!opts.unpivot?.columns?.length) delete opts.unpivot

    const cleanFormats = (opts.column_format || []).filter((f) => f.column?.trim())
    if (cleanFormats.length) opts.column_format = cleanFormats
    else delete opts.column_format

    const cleanRules = (opts.color_rules || []).filter((r) => r.column?.trim() && r.tone)
    if (cleanRules.length) opts.color_rules = cleanRules
    else delete opts.color_rules

    requestClose(() => onSave({
      id: widget?.id || `w${Date.now()}`,
      title: title || 'Untitled',
      type,
      datasource_id: type === 'text' ? null : Number(datasourceId),
      options: opts,
    }))
  }

  return (
    <div className={showPreview ? 'modal-overlay split' : 'modal-overlay'}
      ref={overlayRef} style={{ animation: 'none' }} onClick={requestClose}>
      <form className="card modal" ref={boxRef} style={{ animation: 'none' }} onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, flex: 1 }}>{widget ? 'Edit widget' : 'Add widget'}</h3>
          <button type="button" className="ghost icon" aria-label="Close" onClick={requestClose}>
            <X size={16} />
          </button>
        </div>

        <label>Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="CPU usage" />

        <label>Widget type</label>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <optgroup label="Charts">
            <option value="line">Line chart</option>
            <option value="bar">Bar chart</option>
            <option value="pie">Pie / donut chart</option>
          </optgroup>
          <optgroup label="Single value">
            <option value="stat">Stat (single number)</option>
            <option value="gauge">Gauge</option>
          </optgroup>
          <optgroup label="Other">
            <option value="table">Table</option>
            <option value="text">Text / notes</option>
          </optgroup>
        </select>

        {type === 'text' ? (
          <>
            <label>Text</label>
            <textarea rows={10} value={opts.text || ''}
              onChange={(e) => setOpt('text', e.target.value)}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.5 }}
              placeholder={'## Signing service\n\nNumbers reset at **midnight WIB**.\n\n- Failures exclude result_code 02\n- [Runbook](https://wiki.internal/signing)'} />
            <p className="hint">
              Markdown: <code>#</code> headings, <code>**bold**</code>, <code>*italic*</code>,
              {' '}<code>`code`</code>, <code>- lists</code>, <code>&gt; quotes</code>, links.
            </p>

            <label>Font size</label>
            <div className="field-row">
              <select value={opts.font_size || ''}
                onChange={(e) => setOpt('font_size', e.target.value)}>
                <option value="">Normal (14px)</option>
                <option value="12">Small (12px)</option>
                <option value="16">Large (16px)</option>
                <option value="20">Extra large (20px)</option>
                <option value="28">Huge (28px)</option>
                <option value="40">Display (40px)</option>
              </select>
              <input type="number" min="10" max="96" style={{ width: 110 }}
                value={opts.font_size || ''} placeholder="Custom"
                onChange={(e) => setOpt('font_size', e.target.value)} />
            </div>
            <p className="hint">Headings and code scale with this, so the whole block stays in proportion.</p>

            <label>Alignment</label>
            <div className="field-row">
              <div className="segmented" style={{ flex: 1 }}>
                {[
                  { key: 'left', Icon: AlignLeft, title: 'Align left' },
                  { key: 'center', Icon: AlignCenter, title: 'Align centre' },
                  { key: 'right', Icon: AlignRight, title: 'Align right' },
                ].map(({ key, Icon, title }) => (
                  <button key={key} type="button" title={title} aria-label={title}
                    aria-pressed={(opts.align || 'left') === key}
                    className={(opts.align || 'left') === key ? 'on' : ''}
                    onClick={() => setOpt('align', key)}>
                    <Icon size={15} />
                  </button>
                ))}
              </div>
              <select style={{ width: 130 }} value={opts.valign || 'top'}
                onChange={(e) => setOpt('valign', e.target.value)}>
                <option value="top">Top</option>
                <option value="middle">Middle</option>
                <option value="bottom">Bottom</option>
              </select>
            </div>
          </>
        ) : (
          <>
            <label>Auto refresh</label>
            <select value={opts.refresh_seconds || ''} onChange={(e) => setOpt('refresh_seconds', e.target.value)}>
              <option value="">Off</option>
              <option value="10">Every 10 seconds</option>
              <option value="30">Every 30 seconds</option>
              <option value="60">Every minute</option>
              <option value="300">Every 5 minutes</option>
              <option value="900">Every 15 minutes</option>
            </select>

            <label>Data source</label>
            <select value={datasourceId} onChange={(e) => setDatasourceId(e.target.value)} required>
              <option value="">— select —</option>
              {sources.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.type})</option>)}
            </select>
          </>
        )}

        {source?.type === 'rest' && (
          <>
            <label>Data path (dot path to array in response, optional)</label>
            <input value={opts.data_path || ''} onChange={(e) => setOpt('data_path', e.target.value)}
              placeholder="data.items" />
            <label>Rename columns (old=new, comma separated, optional)</label>
            <input value={renameText} onChange={(e) => setRenameText(e.target.value)}
              placeholder="1=Name, 31=Status, 23=Manufacturer" />
          </>
        )}

        {source?.type === 'sql' && (
          <>
            <label>SQL query</label>
            <textarea rows={5} value={opts.query || ''} required
              onChange={(e) => setOpt('query', e.target.value)}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
              placeholder={'SELECT status, COUNT(*) AS total\nFROM vms\nGROUP BY status'} />
            <p className="hint">SELECT only. Filters below run in the database where possible.</p>
            <label>Row limit</label>
            <input type="number" min="1" value={opts.limit || ''}
              onChange={(e) => setOpt('limit', e.target.value)} placeholder="5000" />
          </>
        )}

        {source?.type === 'elasticsearch' && (
          <>
            <label>Elasticsearch query <span className="optional">— JSON DSL</span></label>
            <textarea rows={9} value={opts.query || ''} required
              onChange={(e) => setOpt('query', e.target.value)}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
              placeholder={'{"query":{"match_all":{}},"sort":[{"@timestamp":"desc"}]}'}/>
            <p className="hint">
              The full search body is sent to Elasticsearch. Aggregations become chartable rows;
              <code>size</code> is limited by Max rows below.
            </p>
            <label>Max rows</label>
            <input type="number" min="1" value={opts.max_rows || ''}
              onChange={(e) => setOpt('max_rows', e.target.value)} placeholder="5000" />
            <label>Time field <span className="optional">(optional)</span></label>
            <input value={opts.time_field || ''}
              onChange={(e) => setOpt('time_field', e.target.value)} placeholder="@timestamp" />
            <label>Time window</label>
            <select
              value={opts.range_minutes ? 'fixed' : (opts.follow_dashboard_range ? 'follow' : 'none')}
              onChange={(e) => {
                const mode = e.target.value
                setOpts((o) => ({
                  ...o,
                  follow_dashboard_range: mode === 'follow',
                  range_minutes: mode === 'fixed' ? (o.range_minutes || 60) : '',
                }))
              }}>
              <option value="follow">Follow dashboard range</option>
              <option value="fixed">Fixed window</option>
              <option value="none">No time filter</option>
            </select>
            {opts.range_minutes ? (
              <input type="number" min="1" value={opts.range_minutes}
                onChange={(e) => setOpt('range_minutes', e.target.value)} placeholder="60" />
            ) : null}
          </>
        )}

        {source?.type === 'glpi' && (
          <>
            <label>Item type</label>
            <input value={opts.itemtype || ''} onChange={(e) => setOpt('itemtype', e.target.value)}
              placeholder="Computer" />
            <p className="hint">e.g. Computer, Ticket, Monitor, NetworkEquipment. Defaults to Computer.</p>
            <label>Fields to return</label>
            <select value={opts.mode || 'search'}
              onChange={(e) => setOpt('mode', e.target.value)}>
              <option value="search">Default columns (GLPI search)</option>
              <option value="list">Every field (raw)</option>
            </select>
            <p className="hint">
              Search mode returns only the columns GLPI shows in its own list view,
              which for some item types is just the name. Raw mode returns every
              stored field — the same thing you see hitting the endpoint directly —
              but dropdowns come back as ids, so pair it with{' '}
              <strong>Rename columns</strong> and a column selection.
            </p>
            <label>Max rows to fetch</label>
            <input type="number" min="1" value={opts.max_rows || ''}
              onChange={(e) => setOpt('max_rows', e.target.value)} placeholder="1000" />
            <p className="hint">
              Hub-Bro pages through GLPI automatically. Raise this if a widget reports
              "showing N of M" — counts only cover the rows actually fetched.
            </p>
            <label>Rename columns <span className="optional">(old=new, comma separated)</span></label>
            <input value={renameText} onChange={(e) => setRenameText(e.target.value)}
              placeholder="states_id=Status, locations_id=Location" />
          </>
        )}

        {source?.type === 'truewatch' && (
          <>
            <label>Query type</label>
            <select value={opts.qtype || 'dql'} onChange={(e) => setOpt('qtype', e.target.value)}>
              <option value="dql">DQL</option>
              <option value="promql">PromQL</option>
            </select>
            <label>{(opts.qtype || 'dql') === 'promql' ? 'PromQL query' : 'DQL query'}</label>
            <textarea rows={3} value={opts.query || ''} required
              onChange={(e) => setOpt('query', e.target.value)}
              placeholder={(opts.qtype || 'dql') === 'promql'
                ? 'rate(http_requests_total[5m])'
                : 'M::`cpu`:(avg(`usage_idle`)) BY `host`'} />
            <p className="hint">
              Namespaces: <code>M::</code> metrics, <code>L::</code> logs, <code>T::</code> tracing,
              <code>R::</code> RUM, <code>O::</code> objects, <code>E::</code> events.
              BY groups become extra columns.
            </p>
            <div className="field-row">
              <div style={{ flex: 1 }}>
                <label>Look-back (minutes)</label>
                <input type="number" min="1" value={opts.range_minutes || ''}
                  onChange={(e) => setOpt('range_minutes', e.target.value)} placeholder="60" />
              </div>
              <div style={{ flex: 1 }}>
                <label>Interval (seconds)</label>
                <input type="number" min="1" value={opts.interval || ''}
                  onChange={(e) => setOpt('interval', e.target.value)} placeholder="auto" />
              </div>
              <div style={{ flex: 1 }}>
                <label>Max points</label>
                <input type="number" min="1" value={opts.max_points || ''}
                  onChange={(e) => setOpt('max_points', e.target.value)} placeholder="360" />
              </div>
            </div>
            <p className="hint">
              A DQL time window written in the query itself, like <code>[1h]</code>, wins over
              the look-back.
            </p>
          </>
        )}

        {source?.type === 'prometheus' && type === 'table' && (
          <>
            <label>Queries <span className="optional">(one per column)</span></label>
            {(opts.queries || []).map((q, i) => (
              <div key={i} className="filter-row">
                <input style={{ flex: 2 }} value={q.query || ''}
                  placeholder="sysGlobalHostCpuUsageRatio"
                  onChange={(e) => setQuery(i, { query: e.target.value })} />
                <input style={{ flex: 1 }} value={q.as || ''} placeholder="Column name"
                  onChange={(e) => setQuery(i, { as: e.target.value })} />
                <button type="button" className="ghost small icon" aria-label="Remove query"
                  onClick={() => setOpt('queries', (opts.queries || []).filter((_, j) => j !== i))}>
                  <X size={13} />
                </button>
              </div>
            ))}
            <button type="button" className="link"
              onClick={() => setOpts((o) => ({
                ...o,
                queries: [...(o.queries || []), { query: '', as: '' }],
                // instance is the one label every scrape carries, so it is the
                // join key far more often than not — still editable
                join: { ...(o.join || {}), on: o.join?.on || 'instance' },
              }))}>
              <Plus size={13} /> Add query
            </button>

            {(opts.queries || []).length > 0 && (
              <>
                <label>Join on <span className="optional">(a label every query returns)</span></label>
                <div className="field-row">
                  <input value={opts.join?.on || ''} placeholder="instance" required
                    onChange={(e) => setOpt('join', { ...(opts.join || {}), on: e.target.value })} />
                  <input value={(opts.join?.carry || []).join(', ')} placeholder="Also keep: instance"
                    onChange={(e) => setOpt('join', {
                      ...(opts.join || {}),
                      carry: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                    })} />
                </div>
                <p className="hint">
                  Prometheus can't return a table, so each query supplies one column and
                  they're matched on this label. A device missing from one query keeps its
                  row with a blank rather than disappearing.
                </p>
              </>
            )}
          </>
        )}

        {source?.type === 'prometheus' && type !== 'table' && (
          <>
            <label>PromQL query</label>
            <input value={opts.query || ''} onChange={(e) => setOpt('query', e.target.value)}
              placeholder='rate(http_requests_total[5m])' required />
            {(type === 'line' || type === 'bar') && (
              <>
                <label>Legend from label <span className="optional">(optional)</span></label>
                <input value={opts.series_field || ''} placeholder="instance"
                  onChange={(e) => setOpt('series_field', e.target.value)} />
                <p className="hint">
                  Names each line after one label. Blank uses the whole label set,
                  which gets long once a query carries more than one.
                </p>

                <label>Time range</label>
                <select
                  value={opts.range_minutes ? 'fixed' : (opts.follow_dashboard_range ? 'follow' : 'instant')}
                  onChange={(e) => {
                    const mode = e.target.value
                    setOpts((o) => ({
                      ...o,
                      follow_dashboard_range: mode === 'follow',
                      range_minutes: mode === 'fixed' ? (o.range_minutes || 60) : '',
                    }))
                  }}>
                  <option value="follow">Follow the dashboard range</option>
                  <option value="fixed">Fixed window</option>
                  <option value="instant">Instant value (no range)</option>
                </select>
                {opts.range_minutes ? (
                  <>
                    <label>Window (minutes)</label>
                    <input type="number" value={opts.range_minutes}
                      onChange={(e) => setOpt('range_minutes', e.target.value)} placeholder="60" />
                    <p className="hint">This widget ignores the dashboard range picker.</p>
                  </>
                ) : null}
              </>
            )}
          </>
        )}

        {(type === 'line' || type === 'bar' || type === 'pie') && source?.type !== 'prometheus' && (
          <>
            <label>{type === 'pie' ? 'Category field' : 'X field'} (optional, defaults to first column)</label>
            <input value={opts.x_field || ''} onChange={(e) => setOpt('x_field', e.target.value)} />
            <label>{type === 'pie' ? 'Value field' : 'Y field'} (optional, defaults to first numeric column)</label>
            <input value={opts.y_field || ''} onChange={(e) => setOpt('y_field', e.target.value)} />
          </>
        )}

        {type === 'pie' && (
          <>
            <label>Show values on slices</label>
            <select value={opts.pie_labels || 'value'}
              onChange={(e) => setOpt('pie_labels', e.target.value)}>
              <option value="value">Value (23,159)</option>
              <option value="percent">Percentage (88%)</option>
              <option value="both">Value and percentage</option>
              <option value="none">Nothing — hover only</option>
            </select>
            <p className="hint">Slices under 3% are left unlabelled so the text doesn't collide.</p>

            <label>Shape</label>
            <select value={opts.pie_style || 'donut'}
              onChange={(e) => setOpt('pie_style', e.target.value)}>
              <option value="donut">Donut</option>
              <option value="pie">Full pie</option>
            </select>

            {(opts.pie_style || 'donut') === 'donut' && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <input type="checkbox" style={{ width: 'auto' }}
                    checked={opts.pie_center !== false}
                    onChange={(e) => setOpt('pie_center', e.target.checked)} />
                  Show the total in the middle
                </label>
                {opts.pie_center !== false && (
                  <>
                    <label>Centre label</label>
                    <input value={opts.pie_center_label || ''} placeholder="Total"
                      onChange={(e) => setOpt('pie_center_label', e.target.value)} />
                  </>
                )}
              </>
            )}
            <p className="hint">Number formatting below applies to the labels and the total.</p>

            <label>Number format</label>
            <div className="field-row">
              <input value={opts.prefix || ''} placeholder="Prefix"
                onChange={(e) => setOpt('prefix', e.target.value)} />
              <input value={opts.suffix || ''} placeholder="Suffix"
                onChange={(e) => setOpt('suffix', e.target.value)} />
              <input type="number" min="0" max="6" style={{ width: 110 }}
                value={opts.decimals ?? ''} placeholder="Decimals"
                onChange={(e) => setOpt('decimals', e.target.value)} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <input type="checkbox" style={{ width: 'auto' }}
                checked={Boolean(opts.compact)}
                onChange={(e) => setOpt('compact', e.target.checked)} />
              Compact numbers (1.2M)
            </label>
          </>
        )}

        {type === 'table' && (
          <>
            <label>Columns to show <span className="optional">(comma separated, after rename)</span></label>
            <input value={colsText} onChange={(e) => setColsText(e.target.value)}
              placeholder="id, name, email" />

            <label>Sort by default <span className="optional">(headers are clickable too)</span></label>
            <div className="field-row">
              <input value={opts.sort_column || ''} placeholder="Column"
                onChange={(e) => setOpt('sort_column', e.target.value)} />
              <select style={{ width: 110 }} value={opts.sort_dir || 'asc'}
                onChange={(e) => setOpt('sort_dir', e.target.value)}>
                <option value="asc">Asc</option>
                <option value="desc">Desc</option>
              </select>
            </div>

            <Section title="Row styling" open={showTableStyling}
              onToggle={() => setShowTableStyling((v) => !v)}
              active={Boolean(opts.color_rules?.length || opts.column_format?.length || barsText)}>
              <label>Colour rules</label>
              {(opts.color_rules || []).map((rule, i) => (
                <div key={i} className="filter-row">
                  <input value={rule.column || ''} placeholder="Column"
                    onChange={(e) => setRule(i, { column: e.target.value })} />
                  <select value={rule.op || 'eq'} onChange={(e) => setRule(i, { op: e.target.value })}>
                    <option value="eq">is</option>
                    <option value="ne">is not</option>
                    <option value="contains">contains</option>
                    <option value="gt">&gt;</option>
                    <option value="gte">≥</option>
                    <option value="lt">&lt;</option>
                    <option value="lte">≤</option>
                  </select>
                  <input value={rule.value ?? ''} placeholder="Value"
                    onChange={(e) => setRule(i, { value: e.target.value })} />
                  <select style={{ width: 110 }} value={rule.tone || 'bad'}
                    onChange={(e) => setRule(i, { tone: e.target.value })}>
                    {TONES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                  <button type="button" className="ghost small icon" aria-label="Remove rule"
                    onClick={() => setOpt('color_rules',
                      (opts.color_rules || []).filter((_, j) => j !== i))}>
                    <X size={13} />
                  </button>
                </div>
              ))}
              <button type="button" className="link"
                onClick={() => setOpt('color_rules',
                  [...(opts.color_rules || []), { column: '', op: 'eq', value: '', tone: 'bad' }])}>
                <Plus size={13} /> Add colour rule
              </button>
              <p className="hint">First matching rule wins. Tick "whole row" style by naming the same column in several rules.</p>

              <label>Number format <span className="optional">(per column)</span></label>
              {(opts.column_format || []).map((spec, i) => (
                <div key={i} className="filter-row">
                  <input value={spec.column || ''} placeholder="Column"
                    onChange={(e) => setFormat(i, { column: e.target.value })} />
                  <input type="number" min="0" max="6" style={{ width: 110 }}
                    value={spec.decimals ?? ''} placeholder="Decimals"
                    onChange={(e) => setFormat(i, { decimals: e.target.value })} />
                  <input style={{ width: 90 }} value={spec.unit || ''} placeholder="Unit"
                    onChange={(e) => setFormat(i, { unit: e.target.value })} />
                  <button type="button" className="ghost small icon" aria-label="Remove format"
                    onClick={() => setOpt('column_format',
                      (opts.column_format || []).filter((_, j) => j !== i))}>
                    <X size={13} />
                  </button>
                </div>
              ))}
              <button type="button" className="link"
                onClick={() => setOpt('column_format',
                  [...(opts.column_format || []), { column: '', decimals: 1, unit: '' }])}>
                <Plus size={13} /> Add number format
              </button>
              <p className="hint">
                Only changes what's shown — sorting and colour rules still use the full value.
              </p>

              <label>Bar columns <span className="optional">(comma separated)</span></label>
              <div className="field-row">
                <input value={barsText} onChange={(e) => setBarsText(e.target.value)}
                  placeholder="CPU Utilization, Memory Utilization" />
                <input type="number" style={{ width: 130 }} min="0"
                  value={opts.bar_max ?? ''} placeholder="Max"
                  onChange={(e) => setOpt('bar_max', e.target.value)} />
              </div>
              <p className="hint">
                Draws a fill behind the number. Leave Max blank to scale to the busiest
                row — percentage columns snap to 0–100 on their own.
              </p>
            </Section>

            <label style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <input type="checkbox" style={{ width: 'auto' }}
                checked={opts.show_filters !== false}
                onChange={(e) => setOpt('show_filters', e.target.checked)} />
              Show the search box and column filters
            </label>
            <p className="hint">Lets anyone narrow the table without opening this dialog.</p>

            <label>Rows to display <span className="optional">(before scrolling)</span></label>
            <input type="number" min="10" value={opts.max_display_rows || ''}
              placeholder="200" onChange={(e) => setOpt('max_display_rows', e.target.value)} />
          </>
        )}

        {type === 'gauge' && (
          <>
            <div className="field-row">
              <div style={{ flex: 1 }}>
                <label>Scale min</label>
                <input type="number" value={opts.gauge_min ?? ''} placeholder="0"
                  onChange={(e) => setOpt('gauge_min', e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Scale max</label>
                <input type="number" value={opts.gauge_max ?? ''} placeholder="100"
                  onChange={(e) => setOpt('gauge_max', e.target.value)} />
              </div>
              <div style={{ width: 90 }}>
                <label>Unit</label>
                <input value={opts.unit || ''} placeholder="%"
                  onChange={(e) => setOpt('unit', e.target.value)} />
              </div>
            </div>
            <p className="hint">The scale sets where the arc starts and ends.</p>
            <label>Label <span className="optional">(blank uses the field name, empty hides it)</span></label>
            <input value={opts.label ?? ''} placeholder={opts.value_field || 'field name'}
              onChange={(e) => setOpt('label', e.target.value)} />
            <label>Value field <span className="optional">(optional, defaults to first numeric column)</span></label>
            <input value={opts.value_field || ''} onChange={(e) => setOpt('value_field', e.target.value)} />
          </>
        )}

        {type === 'stat' && (
          <>
            <label>Label <span className="optional">(blank uses the field name, empty hides it)</span></label>
            <input value={opts.label ?? ''} placeholder={opts.value_field || 'field name'}
              onChange={(e) => setOpt('label', e.target.value)} />
            <label>Value field <span className="optional">(optional, defaults to first numeric column)</span></label>
            <input value={opts.value_field || ''} onChange={(e) => setOpt('value_field', e.target.value)} />

            <label>Alignment</label>
            <div className="field-row">
              <div className="segmented" style={{ flex: 1 }}>
                {[
                  { key: 'left', Icon: AlignLeft, title: 'Align left' },
                  { key: 'center', Icon: AlignCenter, title: 'Align centre' },
                  { key: 'right', Icon: AlignRight, title: 'Align right' },
                ].map(({ key, Icon, title }) => (
                  <button key={key} type="button" title={title} aria-label={title}
                    aria-pressed={(opts.align || 'left') === key}
                    className={(opts.align || 'left') === key ? 'on' : ''}
                    onClick={() => setOpt('align', key)}>
                    <Icon size={15} />
                  </button>
                ))}
              </div>
              <select style={{ width: 130 }} value={opts.valign || 'middle'}
                onChange={(e) => setOpt('valign', e.target.value)}>
                <option value="top">Top</option>
                <option value="middle">Middle</option>
                <option value="bottom">Bottom</option>
              </select>
            </div>

            <label>Value size <span className="optional">(px, blank = default)</span></label>
            <input type="number" min="12" max="120" value={opts.value_size ?? ''}
              placeholder="28" onChange={(e) => setOpt('value_size', e.target.value)} />

            <Section title="Comparison &amp; trend" open={showStatTrend}
              onToggle={() => setShowStatTrend((v) => !v)}
              active={opts.compare_field !== undefined || Boolean(opts.compare_mode)}>
              <label>Compare against <span className="optional">(shows a trend arrow)</span></label>
              <select value={opts.compare_field ? 'field' : (opts.compare_mode || 'none')}
                onChange={(e) => {
                  const mode = e.target.value
                  setOpts((o) => ({
                    ...o,
                    compare_mode: mode === 'previous_row' ? 'previous_row' : undefined,
                    compare_field: mode === 'field' ? (o.compare_field || '') : undefined,
                  }))
                }}>
                <option value="none">Nothing</option>
                <option value="field">Another column in the same row</option>
                <option value="previous_row">The previous row (time series)</option>
              </select>
              {opts.compare_field !== undefined && (
                <>
                  <label>Baseline column</label>
                  <input value={opts.compare_field || ''} placeholder="yesterday"
                    onChange={(e) => setOpt('compare_field', e.target.value)} />
                  <p className="hint">
                    e.g. a second <code>count(*) FILTER (…)</code> in the same query holding
                    the previous period's total.
                  </p>
                </>
              )}
              {(opts.compare_field !== undefined || opts.compare_mode) && (
                <>
                  <label>Caption <span className="optional">(optional)</span></label>
                  <input value={opts.compare_label || ''} placeholder="vs yesterday"
                    onChange={(e) => setOpt('compare_label', e.target.value)} />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <input type="checkbox" style={{ width: 'auto' }}
                      checked={opts.higher_is_better !== false}
                      onChange={(e) => setOpt('higher_is_better', e.target.checked)} />
                    An increase is good (uncheck for failure counts)
                  </label>
                </>
              )}
            </Section>

            <Section title="Extras" open={showStatExtras}
              onToggle={() => setShowStatExtras((v) => !v)}
              active={Boolean(opts.percent_of || opts.sparkline || opts.detail)}>
              <label>Show as a percent of <span className="optional">(another column, optional)</span></label>
              <input value={opts.percent_of ?? ''} placeholder="total"
                onChange={(e) => setOpt('percent_of', e.target.value)} />
              <p className="hint">
                Both numbers must be columns of the same result, so they come from one
                fetch and cannot disagree. “Count into buckets” below has a
                <b> Total column</b> field that produces the denominator.
              </p>

              <label style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <input type="checkbox" style={{ width: 'auto' }}
                  checked={Boolean(opts.sparkline)}
                  onChange={(e) => setOpt('sparkline', e.target.checked)} />
                Show a sparkline
              </label>
              <p className="hint">
                Needs a query that returns one row per time bucket, oldest first —
                e.g. <code>GROUP BY DATE_TRUNC(&apos;hour&apos;, ts) ORDER BY 1</code>.
                The last row becomes the big number and the whole series draws the line.
              </p>
              {opts.sparkline && (
                <>
                  <label>Sparkline column <span className="optional">(blank = the value column)</span></label>
                  <input value={opts.spark_field || ''} placeholder=""
                    onChange={(e) => setOpt('spark_field', e.target.value)} />
                </>
              )}

              <label>Supporting numbers <span className="optional">(optional)</span></label>
              <input value={opts.detail || ''}
                placeholder="{on_track} on track · {warning} warning"
                onChange={(e) => setOpt('detail', e.target.value)} />
              <p className="hint">
                Free text with <code>{'{column}'}</code> placeholders, filled from this same
                query. Lets one tile answer &quot;is that number bad?&quot; without a drill-down.
              </p>
              {(() => {
                const used = templateColumns(opts.detail)
                if (!used.length) return null
                // Warn about typos while editing rather than rendering an em dash
                // on the dashboard and leaving them to wonder why.
                const known = availableColumns
                const unknown = known.length ? used.filter((c) => !known.includes(c)) : []
                return (
                  <p className="hint">
                    {unknown.length
                      ? <span className="danger-text">
                          Not in this query: {unknown.join(', ')}
                          {known.length ? ` — available: ${known.join(', ')}` : ''}
                        </span>
                      : `Using: ${used.join(', ')}`}
                  </p>
                )
              })()}
            </Section>
          </>
        )}

        {(type === 'stat' || type === 'gauge') && (
          <Section title="Thresholds &amp; number format" open={showThresholds}
            onToggle={() => setShowThresholds((v) => !v)}
            active={Boolean(
              opts.thresholds?.warn || opts.thresholds?.critical || opts.prefix || opts.suffix
                || (opts.decimals ?? '') !== '' || opts.compact || opts.thousands === false
                || (opts.aggregate && opts.aggregate !== 'last')
            )}>
            <label>Thresholds <span className="optional">(optional)</span></label>
            <div className="field-row">
              <select style={{ width: 160 }} value={opts.thresholds?.direction || 'above'}
                onChange={(e) => setOpt('thresholds', { ...(opts.thresholds || {}), direction: e.target.value })}>
                <option value="above">Alert when ≥</option>
                <option value="below">Alert when ≤</option>
              </select>
              <input type="number" placeholder="Warn at" value={opts.thresholds?.warn ?? ''}
                onChange={(e) => setOpt('thresholds', { ...(opts.thresholds || {}), warn: e.target.value })} />
              <input type="number" placeholder="Critical at" value={opts.thresholds?.critical ?? ''}
                onChange={(e) => setOpt('thresholds', { ...(opts.thresholds || {}), critical: e.target.value })} />
            </div>
            <p className="hint">
              {type === 'gauge'
                ? 'Colours the arc and marks where each threshold sits on the scale.'
                : 'Colours the number and shows a badge when breached.'}
            </p>

            <label>Number format</label>
            <div className="field-row">
              <div style={{ flex: 1 }}>
                <input value={opts.prefix || ''} placeholder="Prefix  e.g. Rp"
                  onChange={(e) => setOpt('prefix', e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <input value={opts.suffix || ''} placeholder="Suffix  e.g. ms"
                  onChange={(e) => setOpt('suffix', e.target.value)} />
              </div>
              <div style={{ width: 110 }}>
                <input type="number" min="0" max="6" value={opts.decimals ?? ''}
                  placeholder="Decimals"
                  onChange={(e) => setOpt('decimals', e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 18, marginTop: 10, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, margin: 0 }}>
                <input type="checkbox" style={{ width: 'auto' }}
                  checked={opts.thousands !== false}
                  onChange={(e) => setOpt('thousands', e.target.checked)} />
                Thousands separator
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, margin: 0 }}>
                <input type="checkbox" style={{ width: 'auto' }}
                  checked={Boolean(opts.compact)}
                  onChange={(e) => setOpt('compact', e.target.checked)} />
                Compact (1.2M)
              </label>
            </div>

            <label>Aggregate</label>
            <select value={opts.aggregate || 'last'} onChange={(e) => setOpt('aggregate', e.target.value)}>
              <option value="last">Last value</option>
              <option value="sum">Sum</option>
              <option value="avg">Average</option>
              <option value="count">Row count</option>
            </select>
          </Section>
        )}

        {type === 'table' && (
          <>
            <label>Link columns <span className="optional">(one per line: column = url)</span></label>
            <textarea rows={3} value={columnLinksText}
              onChange={(e) => setColumnLinksText(e.target.value)}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
              placeholder={'ticket_id = https://helpdesk.internal/ticket/{ticket_id}\nname = /dashboards/3'} />
            <p className="hint">
              Use <code>{'{column}'}</code> to insert a value from the row. Values are
              URL-encoded. A row missing that value shows plain text instead of a broken link.
            </p>
          </>
        )}

        {type !== 'text' && (
          <>
            <label>Header link <span className="optional">(optional)</span></label>
            <div className="field-row">
              <select style={{ width: 150 }}
                value={opts.link && !opts.link.startsWith('/dashboards/') ? 'url' : 'dashboard'}
                onChange={(e) => setOpt('link', e.target.value === 'url' ? 'https://' : '')}>
                <option value="dashboard">Another dashboard</option>
                <option value="url">External link</option>
              </select>
              {(!opts.link || opts.link.startsWith('/dashboards/')) ? (
                <select value={opts.link || ''} onChange={(e) => setOpt('link', e.target.value)}>
                  <option value="">— none —</option>
                  {dashboardList.filter((d) => d.id !== currentDashboardId).map((d) => (
                    <option key={d.id} value={`/dashboards/${d.id}`}>{d.name}</option>
                  ))}
                </select>
              ) : (
                <input value={opts.link} placeholder="https://wiki.internal/runbook"
                  onChange={(e) => setOpt('link', e.target.value)} />
              )}
            </div>
            {opts.link && (
              <>
                <label>Link text</label>
                <input value={opts.link_label || ''} placeholder="Open"
                  onChange={(e) => setOpt('link_label', e.target.value)} />
              </>
            )}

            <label>Accent colour <span className="optional">(overrides the dashboard theme)</span></label>
            <div className="field-row">
              <input type="color" style={{ width: 52, padding: 3, height: 38 }}
                value={opts.accent || '#00694a'}
                onChange={(e) => setOpt('accent', e.target.value)} />
              <input value={opts.accent || ''} placeholder="Uses the dashboard theme"
                onChange={(e) => setOpt('accent', e.target.value)} />
              {opts.accent && (
                <button type="button" className="secondary"
                  onClick={() => setOpt('accent', '')}>Clear</button>
              )}
            </div>

            {opts.accent && ['stat', 'gauge', 'text'].includes(type) && (
              <>
                <label>Apply it to</label>
                <select value={opts.widget_bg || 'none'}
                  onChange={(e) => setOpt('widget_bg', e.target.value)}>
                  <option value="none">The value only</option>
                  <option value="soft">Tinted card background</option>
                  <option value="solid">Filled card background</option>
                </select>
                <p className="hint">
                  {opts.widget_bg === 'solid'
                    ? 'Text flips to white or black automatically, whichever reads better on your colour.'
                    : 'A filled card makes one number readable from across the room.'}
                </p>
              </>
            )}
            {opts.accent && !['stat', 'gauge', 'text'].includes(type) && (
              <p className="hint">
                Coloured backgrounds are limited to stat, gauge and text widgets —
                a fill behind a chart or table hurts readability.
              </p>
            )}
            {!opts.accent && (
              <p className="hint">Useful for making one critical number stand out.</p>
            )}
          </>
        )}

        <div className="section-toggle">
          <button type="button" className="link" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Filter &amp; summarize
            {(opts.group_by || opts.filters?.length) && !showAdvanced && <span className="dot" />}
          </button>
        </div>

        {showAdvanced && (
          <div className="subsection">
            <label>Turn a date into a number
              <span className="optional"> — for expiry and age</span>
            </label>
            {(opts.date_diff || []).map((d, i) => (
              <div className="field-grid" key={i}
                style={{ gridTemplateColumns: '1.6fr 1.1fr .8fr 1.2fr 1.2fr 1.2fr auto' }}>
                <div>
                  <span className="cap">Date column</span>
                  <input value={d.column || ''} placeholder="expire"
                    onChange={(e) => setDateDiff(i, { column: e.target.value })} />
                </div>
                <div>
                  <span className="cap">Direction</span>
                  <select value={d.direction || 'until'}
                    onChange={(e) => setDateDiff(i, { direction: e.target.value })}>
                    <option value="until">until</option>
                    <option value="since">since</option>
                  </select>
                </div>
                <div>
                  <span className="cap">Unit</span>
                  <select value={d.unit || 'days'}
                    onChange={(e) => setDateDiff(i, { unit: e.target.value })}>
                    <option value="days">days</option>
                    <option value="hours">hours</option>
                    <option value="minutes">minutes</option>
                  </select>
                </div>
                <div>
                  <span className="cap">+ months from</span>
                  <input value={d.plus_months || ''} placeholder="duration"
                    title="Column holding a duration in months, e.g. a GLPI contract's duration"
                    onChange={(e) => setDateDiff(i, { plus_months: e.target.value })} />
                </div>
                <div>
                  <span className="cap">Number column</span>
                  <input value={d.as || ''} placeholder="days_left"
                    onChange={(e) => setDateDiff(i, { as: e.target.value })} />
                </div>
                <div>
                  <span className="cap">Month column</span>
                  <input value={d.label_as || ''} placeholder="expires_month"
                    title="Also output the resolved date as a YYYY-MM label, for grouping into a chart"
                    onChange={(e) => setDateDiff(i, { label_as: e.target.value })} />
                </div>
                <button type="button" className="danger ghost small icon remove" aria-label="Remove this date column"
                  onClick={() => setOpt('date_diff', opts.date_diff.filter((_, j) => j !== i))}>
                  <X size={13} />
                </button>
              </div>
            ))}
            <button type="button" className="link"
              onClick={() => setOpt('date_diff', [...(opts.date_diff || []),
                { column: '', as: '', unit: 'days', direction: 'until' }])}>
              <Plus size={13} /> Add a date column
            </button>
            <p className="hint">
              Adds a numeric column you can threshold, colour and sort on — a date
              cannot be. Negative means already past, so an expired licence reads
              as <code>-294</code>. Rows with no date stay empty rather than
              counting as zero. Use <strong>+ months</strong> when the end date is
              not stored: a GLPI contract keeps <code>begin_date</code> and a{' '}
              <code>duration</code> in months, so put <code>duration</code> there.
            </p>

            <label>Count into buckets
              <span className="optional"> — several numbers on one widget</span>
            </label>
            <div className="field-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', marginBottom: 6 }}>
              <div>
                <span className="cap">Column to count</span>
                <input value={opts.count_by?.column || ''} placeholder="days_left, value"
                  onChange={(e) => setOpt('count_by', { ...(opts.count_by || {}), column: e.target.value })} />
              </div>
              <div>
                <span className="cap">Name for blanks</span>
                <input value={opts.count_by?.unknown_as || ''} placeholder="optional"
                  onChange={(e) => setOpt('count_by', { ...(opts.count_by || {}), unknown_as: e.target.value })} />
              </div>
              <div>
                <span className="cap">Name for the total</span>
                <input value={opts.count_by?.total_as || ''} placeholder="optional"
                  onChange={(e) => setOpt('count_by', { ...(opts.count_by || {}), total_as: e.target.value })} />
              </div>
            </div>
            {(opts.count_by?.buckets || []).map((b, i) => (
              <div className="field-grid" key={i}
                style={{ gridTemplateColumns: '1.3fr 1.3fr .9fr .9fr auto' }}>
                <div>
                  <span className="cap">Name it</span>
                  <input value={b.as || ''} placeholder="expired"
                    onChange={(e) => setBucket(i, { as: e.target.value })} />
                </div>
                <div>
                  <span className="cap">When the text is</span>
                  <input value={b.equals ?? ''} placeholder="PROTECTED"
                    onChange={(e) => setBucket(i, { equals: e.target.value })} />
                </div>
                <div>
                  <span className="cap">or from</span>
                  <input value={b.min ?? ''} placeholder="—" disabled={Boolean(b.equals)}
                    title={b.equals ? 'A bucket counts text or a range, not both' : undefined}
                    onChange={(e) => setBucket(i, { min: e.target.value })} />
                </div>
                <div>
                  <span className="cap">to (inclusive)</span>
                  <input value={b.max ?? ''} placeholder="-1" disabled={Boolean(b.equals)}
                    title={b.equals ? 'A bucket counts text or a range, not both' : undefined}
                    onChange={(e) => setBucket(i, { max: e.target.value })} />
                </div>
                <button type="button" className="danger ghost small icon remove" aria-label="Remove bucket"
                  onClick={() => setOpt('count_by', {
                    ...opts.count_by,
                    buckets: opts.count_by.buckets.filter((_, j) => j !== i),
                  })}>
                  <X size={13} />
                </button>
              </div>
            ))}
            <button type="button" className="link"
              onClick={() => setOpt('count_by', {
                ...(opts.count_by || {}),
                buckets: [...(opts.count_by?.buckets || []), { as: '', min: '', max: '' }],
              })}>
              <Plus size={13} /> Add a bucket
            </button>
            <p className="hint">
              Replaces the rows with a single row holding one count per bucket, so a
              stat widget can headline one number and show the others underneath.
              Each bucket counts one thing: a text value, for status columns
              (<code>PROTECTED</code> — case and spacing are ignored, and
              <code>LOST, DISCONNECTED</code> counts either), or a numeric range for
              columns like <code>days_left</code>. Ranges are inclusive and the first
              match wins, so the counts always add up. Rows no bucket claims land in the
              optional <em>blanks</em> bucket rather than being counted as zero.
            </p>

            <label>Split columns into rows <span className="optional">(unpivot)</span></label>
            <input value={unpivotText} onChange={(e) => setUnpivotText(e.target.value)}
              placeholder="sukses, gagal" />
            <p className="hint">
              Turns one wide row into one row per column — needed for charts when a query
              returns totals side by side. Produces a <code>name</code> and <code>value</code> column.
            </p>

            <label>Filter rows</label>
            {filters.map((f, i) => (
              <div key={i} className="filter-row">
                <input value={f.column} placeholder="Column"
                  onChange={(e) => setFilter(i, { column: e.target.value })} />
                <select value={f.op} onChange={(e) => setFilter(i, { op: e.target.value })}>
                  <option value="eq">is</option>
                  <option value="ne">is not</option>
                  <option value="contains">contains</option>
                  <option value="in">is one of</option>
                  <option value="gt">&gt;</option>
                  <option value="gte">≥</option>
                  <option value="lt">&lt;</option>
                  <option value="lte">≤</option>
                  <option value="not_empty">is not empty</option>
                </select>
                <input value={f.value} placeholder="Value" disabled={f.op === 'not_empty'}
                  onChange={(e) => setFilter(i, { value: e.target.value })} />
                <button type="button" className="ghost small icon" aria-label="Remove filter"
                  onClick={() => setFilters((rows) =>
                    rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ column: '', op: 'eq', value: '' }])}>
                  <X size={13} />
                </button>
              </div>
            ))}
            <button type="button" className="link"
              onClick={() => setFilters((rows) => [...rows, { column: '', op: 'eq', value: '' }])}>
              <Plus size={13} /> Add filter
            </button>

            <label>Group by <span className="optional">(one row per distinct value)</span></label>
            <input value={opts.group_by || ''} onChange={(e) => setOpt('group_by', e.target.value)}
              placeholder="Status" />
            {opts.group_by && (
              <>
                <label>Summarize with</label>
                <select value={opts.aggregate || 'count'} onChange={(e) => setOpt('aggregate', e.target.value)}>
                  <option value="count">Count of rows</option>
                  <option value="sum">Sum of a column</option>
                  <option value="avg">Average of a column</option>
                  <option value="min">Minimum</option>
                  <option value="max">Maximum</option>
                </select>
                {opts.aggregate && opts.aggregate !== 'count' && (
                  <>
                    <label>Column to summarize</label>
                    <input value={opts.value_column || ''}
                      onChange={(e) => setOpt('value_column', e.target.value)} placeholder="cost" />
                  </>
                )}
                <p className="hint">
                  Charts this as {opts.group_by} vs {opts.aggregate === 'count' || !opts.aggregate
                    ? 'count' : `${opts.aggregate}_${opts.value_column || 'value'}`}.
                </p>
              </>
            )}

            <label>Sort by <span className="optional">(optional)</span></label>
            <div className="field-row">
              <input value={opts.sort?.column || ''}
                onChange={(e) => setOpt('sort', { ...(opts.sort || {}), column: e.target.value })}
                placeholder="count" />
              <select style={{ width: 110 }} value={opts.sort?.dir || 'asc'}
                onChange={(e) => setOpt('sort', { ...(opts.sort || {}), dir: e.target.value })}>
                <option value="asc">Asc</option>
                <option value="desc">Desc</option>
              </select>
            </div>

            <label>Limit rows <span className="optional">(optional)</span></label>
            <input type="number" min="1" value={opts.limit || ''}
              onChange={(e) => setOpt('limit', e.target.value)} placeholder="10" />
          </div>
        )}

        {error && <p className="error" role="alert">{error}</p>}

        <div className="modal-footer">
          {type !== 'text' && (
            <button type="button" className="secondary" style={{ marginRight: 'auto' }}
              aria-pressed={showPreview}
              onClick={() => setShowPreview((v) => !v)}>
              <Eye size={14} /> {showPreview ? 'Hide preview' : 'Live preview'}
            </button>
          )}
          <button type="button" className="secondary" onClick={requestClose}>Cancel</button>
          <button type="submit">Save</button>
        </div>

      </form>

      {/* A sibling of the form, not a child: nested inside it the panel inherited
          the modal's own scroll box and width, which is what pinned it into that
          cramped strip. */}
      {showPreview && (
        <WidgetPreviewModal
          docked
          widget={{
            id: widget?.id || 'preview',
            title,
            type,
            datasource_id: Number(datasourceId),
            options: opts,
          }}
          sources={sources}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  )
}
