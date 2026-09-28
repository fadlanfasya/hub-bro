import { useCallback, useEffect, useRef, useState } from 'react'

function socketUrl(dashboardId, token) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/api/presence/${dashboardId}?token=${encodeURIComponent(token)}`
}

/** Track signed-in users currently viewing one dashboard. */
export function usePresence(dashboardId) {
  const [collaborators, setCollaborators] = useState([])
  const [cursors, setCursors] = useState([])
  const socketRef = useRef(null)
  const retryRef = useRef(null)
  const frameRef = useRef(null)
  const pendingCursorRef = useRef(null)
  const stoppedRef = useRef(false)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!dashboardId || !token) return undefined

    stoppedRef.current = false
    let retryMs = 1000

    const connect = () => {
      if (stoppedRef.current) return
      const socket = new WebSocket(socketUrl(dashboardId, token))
      socketRef.current = socket
      socket.onopen = () => { retryMs = 1000 }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          if (message.type === 'presence') setCollaborators(message.collaborators || [])
          if (message.type === 'cursors') setCursors(message.cursors || [])
        } catch {
          // Ignore malformed presence messages; dashboard data is unaffected.
        }
      }
      socket.onclose = () => {
        if (stoppedRef.current) return
        retryRef.current = window.setTimeout(connect, retryMs)
        retryMs = Math.min(retryMs * 2, 15000)
      }
    }

    connect()
    return () => {
      stoppedRef.current = true
      window.clearTimeout(retryRef.current)
      socketRef.current?.close()
      socketRef.current = null
      setCollaborators([])
      setCursors([])
      pendingCursorRef.current = null
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current)
    }
  }, [dashboardId])

  const sendCursor = useCallback((cursor) => {
    pendingCursorRef.current = cursor
    if (frameRef.current) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      const socket = socketRef.current
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'cursor', cursor: pendingCursorRef.current }))
      }
    })
  }, [])

  return { collaborators, cursors, sendCursor }
}
