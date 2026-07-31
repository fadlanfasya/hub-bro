import { useState } from 'react'
import {
  X, Plus, ChevronDown, ChevronRight, AlignLeft, AlignCenter, AlignRight,
} from 'lucide-react'
import { TONES } from '../tableRules'

export default function WidgetConfigModal({ widget, sources, onSave, onClose }) {
  const [title, setTitle] = useState(widget?.title || '')
  const [type, setType] = useState(widget?.type || 'line')
  const [datasourceId, setDatasourceId] = useState(widget?.datasource_id || sources[0]?.id || '')
  const [opts, setOpts] = useState(widget?.options || {})

  const [colsText, setColsText] = useState((widget?.options?.columns || []).join(', '))
  const [renameText, setRenameText] = useState(
    Object.entries(widget?.options?.rename || {}).map(([k, v]) => `${k}=${v}`).join(', ')
  )

  const [filters, setFilters] = useState(
    widget?.options?.filters?.length
      ? widget.options.filters
      : [{ column: '', op: 'eq', value: '' }]
  )
  const [unpivotText, setUnpivotText] = useState(
    (widget?.options?.unpivot?.columns || []).join(', ')
  )
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(widget?.options?.group_by || widget?.options?.filters?.length
      || widget?.options?.sort || widget?.options?.unpivot)
  )

  const source = sources.find((s) => s.id === Number(datasourceId))
  const setOpt = (k, v) => setOpts((o) => ({ ...o, [k]: v }))
  const setFilter = (i, patch) =>
    setFilters((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const setRule = (i, patch) =>
    setOpt('color_rules', (opts.color_rules || []).map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const save = (e) => {
    e.preventDefault()
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
    if (!opts.accent) delete opts.accent
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
    const cleanRules = (opts.color_rules || []).filter((r) => r.column?.trim() && r.tone)
    if (cleanRules.length) opts.color_rules = cleanRules
    else delete opts.color_rules

    onSave({
      id: widget?.id || `w${Date.now()}`,
      title: title || 'Untitled',
      type,
      datasource_id: type === 'text' ? null : Number(datasourceId),
      options: opts,
    })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, flex: 1 }}>{widget ? 'Edit widget' : 'Add widget'}</h3>
          <button type="button" className="ghost icon" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <label>Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="CPU usage" />

        <label>Widget type</label>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="line">Line chart</option>
          <option value="bar">Bar chart</option>
          <option value="pie">Pie / donut chart</option>
          <option value="stat">Stat (single number)</option>
          <option value="gauge">Gauge</option>
          <option value="table">Table</option>
          <option value="text">Text / notes</option>
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

        {source?.type === 'glpi' && (
          <>
            <label>Item type</label>
            <input value={opts.itemtype || ''} onChange={(e) => setOpt('itemtype', e.target.value)}
              placeholder="Computer" />
            <p className="hint">e.g. Computer, Ticket, Monitor, NetworkEquipment. Defaults to Computer.</p>
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

        {source?.type === 'prometheus' && (
          <>
            <label>PromQL query</label>
            <input value={opts.query || ''} onChange={(e) => setOpt('query', e.target.value)}
              placeholder='rate(http_requests_total[5m])' required />
            {(type === 'line' || type === 'bar') && (
              <>
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
            <p className="hint">The gauge uses the same value field, aggregate and thresholds as a stat widget.</p>
          </>
        )}

        {type === 'stat' && (
          <>
            <label>Label <span className="optional">(blank uses the field name, empty hides it)</span></label>
            <input value={opts.label ?? ''} placeholder={opts.value_field || 'field name'}
              onChange={(e) => setOpt('label', e.target.value)} />

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

            <label>Value size <span className="optional">(px, blank = default)</span></label>
            <input type="number" min="12" max="120" value={opts.value_size ?? ''}
              placeholder="28" onChange={(e) => setOpt('value_size', e.target.value)} />

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
          </>
        )}

        {(type === 'stat' || type === 'gauge') && (
          <>
            <label>Value field (optional)</label>
            <input value={opts.value_field || ''} onChange={(e) => setOpt('value_field', e.target.value)} />
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
            <p className="hint">Colours the number and shows a badge when breached.</p>

            <label>Aggregate</label>
            <select value={opts.aggregate || 'last'} onChange={(e) => setOpt('aggregate', e.target.value)}>
              <option value="last">Last value</option>
              <option value="sum">Sum</option>
              <option value="avg">Average</option>
              <option value="count">Row count</option>
            </select>
          </>
        )}

        {type !== 'text' && (
          <>
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
            <p className="hint">Useful for making one critical number stand out.</p>
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

        <div className="modal-footer">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="submit">Save</button>
        </div>
      </form>
    </div>
  )
}
