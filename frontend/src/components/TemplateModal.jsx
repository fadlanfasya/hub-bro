import { useEffect, useMemo, useState } from 'react'
import { Download, FileUp, X } from 'lucide-react'
import { dashboards, datasources } from '../api'

export default function TemplateModal({ onImported, onClose }) {
  const [templates, setTemplates] = useState([])
  const [sources, setSources] = useState([])
  const [selectedKey, setSelectedKey] = useState('')
  const [uploaded, setUploaded] = useState(null)
  const [mapping, setMapping] = useState({})
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)

  useEffect(() => {
    Promise.all([dashboards.templates(), datasources.list()])
      .then(([templateRes, sourceRes]) => {
        setTemplates(templateRes.data)
        setSources(sourceRes.data)
        setSelectedKey(templateRes.data[0]?.key || '')
      })
      .catch((err) => setError(err.response?.data?.detail || 'Could not load templates'))
  }, [])

  const selected = uploaded || templates.find((item) => item.key === selectedKey)
  const sourceOptions = useMemo(() => {
    const result = {}
    for (const required of selected?.required_sources || []) {
      result[required.key] = sources.filter((source) => source.type === required.type)
    }
    return result
  }, [selected, sources])

  const choose = (key) => {
    setUploaded(null)
    setSelectedKey(key)
    setMapping({})
    setName('')
    setError('')
  }

  const loadFile = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const template = JSON.parse(reader.result)
        if (!template.definition || !Array.isArray(template.required_sources)) {
          throw new Error('Template must contain definition and required_sources')
        }
        setUploaded(template)
        setMapping({})
        setName(template.name || '')
        setError('')
      } catch (err) {
        setError(err.message || 'Template file is not valid JSON')
      }
    }
    reader.readAsText(file)
  }

  const importSelected = async (event) => {
    event.preventDefault()
    setError('')
    setWorking(true)
    try {
      const response = await dashboards.importTemplate({
        ...(uploaded ? { template: selected } : { template_key: selectedKey }),
        name: name.trim() || selected?.name,
        datasource_map: mapping,
        visibility: 'workspace',
      })
      onImported(response.data)
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not import template')
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="card modal template-modal" onClick={(event) => event.stopPropagation()}
        onSubmit={importSelected}>
        <div className="page-header" style={{ marginBottom: 14 }}>
          <div>
            <h3 style={{ margin: 0 }}>Dashboard templates</h3>
            <p className="hint" style={{ margin: '4px 0 0' }}>Start with a ready-made dashboard and connect your own sources.</p>
          </div>
          <span className="spacer" />
          <button type="button" className="secondary small icon" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {templates.length > 0 && (
          <>
            <label>Template</label>
            <input type="file" accept="application/json,.json" onChange={loadFile} />
            <select value={selectedKey} onChange={(event) => choose(event.target.value)}>
              {templates.map((template) => (
                <option key={template.key} value={template.key}>{template.name}</option>
              ))}
            </select>
            {selected && <p className="hint">{selected.description}</p>}

            <label>Dashboard name</label>
            <input value={name} onChange={(event) => setName(event.target.value)}
              placeholder={selected?.name || 'Imported dashboard'} />

            {(selected?.required_sources || []).map((required) => (
              <div key={required.key}>
                <label>{required.label || required.key} <span className="optional">({required.type})</span></label>
                <select required value={mapping[required.key] || ''}
                  onChange={(event) => setMapping((current) => ({
                    ...current, [required.key]: Number(event.target.value),
                  }))}>
                  <option value="">Choose a data source…</option>
                  {(sourceOptions[required.key] || []).map((source) => (
                    <option key={source.id} value={source.id}>{source.name}</option>
                  ))}
                </select>
                {!sourceOptions[required.key]?.length && (
                  <p className="hint">No compatible source is available. Add one first.</p>
                )}
              </div>
            ))}
          </>
        )}

        {error && <div className="error">{error}</div>}
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={working || !selectedKey}>
            <FileUp size={14} /> {working ? 'Importing…' : 'Import dashboard'}
          </button>
        </div>
      </form>
    </div>
  )
}

export function downloadTemplate(template, filename) {
  const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename || 'dashboard-template'}.json`
  link.click()
  URL.revokeObjectURL(url)
}

export function TemplateIcon() {
  return <Download size={13} />
}
