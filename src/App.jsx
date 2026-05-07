import { useEffect, useMemo, useRef, useState } from 'react'

const WS_URL = import.meta.env.VITE_WS_URL;
const DEFAULT_ROOM = 'room1'

function createRandomName() {
  return `player-${Math.random().toString(36).slice(2, 7)}`
}

function App() {
  const [socket, setSocket] = useState(null)
  const [connected, setConnected] = useState(false)
  const [status, setStatus] = useState('서버 연결 중...')
  const [roomId, setRoomId] = useState(DEFAULT_ROOM)
  const [name, setName] = useState(createRandomName())
  const [playerId, setPlayerId] = useState('')
  const [room, setRoom] = useState(null)
  const [numberInput, setNumberInput] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('방에 참가하여 게임을 시작하세요.')
  const [connectionKey, setConnectionKey] = useState(0)
  const [showCreateRoom, setShowCreateRoom] = useState(false)
  const socketRef = useRef(null)
  const titleTapTimesRef = useRef([])

  useEffect(() => {
    const ws = new WebSocket('ws://13.124.25.249:4000')
    // const ws = new WebSocket(WS_URL)
    ws.onopen = () => {
      setConnected(true)
      setStatus('서버 연결됨')
      setInfo('이름과 방 번호를 입력한 후 참가 버튼을 눌러주세요.')
    }
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        handleServerMessage(data)
      } catch (err) {
        console.error('Invalid message', err)
      }
    }
    ws.onclose = () => {
      setConnected(false)
      setStatus('서버 연결 끊김')
      setInfo('서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.')
    }
    ws.onerror = () => {
      setStatus('웹소켓 오류')
    }

    socketRef.current = ws
    setSocket(ws)

    return () => {
      ws.close()
    }
  }, [connectionKey])

  const sendMessage = (type, payload) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setError('서버에 연결되어 있지 않습니다.')
      return
    }
    socketRef.current.send(JSON.stringify({ type, payload }))
  }

  const handleServerMessage = (data) => {
    switch (data.type) {
      case 'joined':
        setPlayerId(data.payload.playerId)
        setRoom(data.payload.room)
        setStatus('방에 참가했습니다.')
        setInfo('숫자를 입력하거나 호스트가 중지를 누르기를 기다리세요.')
        setError('')
        break
      case 'roomState':
        setRoom(data.payload.room)
        if (data.payload.message) {
          setInfo(data.payload.message)
        }
        break
      case 'error':
        setError(data.payload.message)
        break
      default:
        console.warn('Unknown message', data)
        break
    }
  }

  const handleTitleTap = () => {
    if (me) return
    const now = Date.now()
    titleTapTimesRef.current.push(now)
    titleTapTimesRef.current = titleTapTimesRef.current.filter((t) => now - t <= 800)
    if (titleTapTimesRef.current.length >= 5) {
      titleTapTimesRef.current = []
      setShowCreateRoom((prev) => !prev)
    }
  }

  const createRoom = () => {
    if (!connected) {
      setError('서버에 연결되어 있어야 합니다.')
      return
    }
    if (!name.trim()) {
      setError('이름을 입력해주세요.')
      return
    }
    setError('')
    sendMessage('create', { roomId: roomId.trim() || DEFAULT_ROOM, name: name.trim() })
  }

  const joinRoom = () => {
    if (!connected) {
      setError('서버에 연결되어 있어야 합니다.')
      return
    }
    if (!name.trim()) {
      setError('이름을 입력해주세요.')
      return
    }
    setError('')
    sendMessage('join', { roomId: roomId.trim() || DEFAULT_ROOM, name: name.trim() })
  }

  const submitNumber = () => {
    const value = parseFloat(numberInput)
    if (Number.isNaN(value)) {
      setError('숫자를 정상적으로 입력해주세요.')
      return
    }
    setError('')
    sendMessage('submit', { roomId, number: value })
    setNumberInput('')
  }

  const stopGame = () => {
    sendMessage('stop', { roomId })
  }

  const resetGame = () => {
    sendMessage('reset', { roomId })
  }

  const leaveRoom = () => {
    if (socketRef.current) socketRef.current.close()
    setRoom(null)
    setPlayerId('')
    setError('')
    setConnectionKey((k) => k + 1)
  }

  const me = useMemo(() => {
    if (!room || !playerId) return null
    return room.players.find((player) => player.id === playerId) || null
  }, [room, playerId])

  const isHost = room?.hostId === playerId
  const canSubmit = room && room.status === 'playing' && me && !me.submitted

  const renderPlayerRow = (player) => {
    const isMe = player.id === playerId
    const rowClass = player.isWinner ? 'winner' : player.isPreliminary ? 'preliminary' : ''
    const numberLabel = room?.status === 'ended' ? player.number ?? '-' : player.submitted ? '입력 완료' : '미입력'

    return (
      <tr key={player.id} className={rowClass}>
        <td>{player.name}{isMe ? ' (나)' : ''}</td>
        <td>{player.id === room.hostId ? '호스트' : '참가자'}</td>
        <td>{numberLabel}</td>
        <td>{player.isWinner ? '🏆' : '-'}</td>
      </tr>
    )
  }

  return (
    <div className="app-shell">
      <header>
        <h1 onClick={handleTitleTap} style={{ userSelect: 'none', cursor: 'default' }}>숫자 중앙 게임</h1>
        <p>모든 참가자가 숫자를 한 번 입력하거나 호스트가 중지를 누르면 가장 가운데에 가까운 사람이 승리합니다.</p>
      </header>

      {!me && (
        <section className="panel">
          <div className="field-row">
            <label>방 번호</label>
            <input value={roomId} onChange={(e) => setRoomId(e.target.value)} />
          </div>
          <div className="field-row">
            <label>이름</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button onClick={joinRoom} disabled={!connected}>
            참가하기
          </button>
          {showCreateRoom && (
            <button onClick={createRoom} disabled={!connected}>
              방만들기
            </button>
          )}
          <div className="status-row">
            <span>{status}</span>
            <span>{info}</span>
          </div>
          {error && <div className="error">{error}</div>}
        </section>
      )}

      {room && (
        <section className="panel">
          <h2>방 정보</h2>
          <div className="room-meta">
            <div>방 번호: {room.id}</div>
            <div>호스트: {room.hostName || '<알 수 없음>'}</div>
            <div>상태: {room.status === 'ended' ? '결과 발표' : '진행 중'}</div>
            <div>참가자 수: {room.players.length}</div>
            {room.status === 'ended' && <div>중앙값: {room.target}</div>}
            {room.status === 'ended' && <div>평균: {room.mean?.toFixed(2)}</div>}
          </div>

          <div className="controls">
            {canSubmit && (
              <>
                <input
                  type="number"
                  placeholder="숫자 입력"
                  value={numberInput}
                  onChange={(e) => setNumberInput(e.target.value)}
                />
                <button onClick={submitNumber}>제출</button>
              </>
            )}
            {isHost && room.status === 'playing' && (
              <button className="danger" onClick={stopGame}>호스트 중지</button>
            )}
            {isHost && room.status === 'ended' && (
              <button onClick={resetGame}>새 게임 시작</button>
            )}
          </div>

          <table>
            <thead>
              <tr>
                <th>이름</th>
                <th>역할</th>
                <th>입력 상태</th>
                <th>승리</th>
              </tr>
            </thead>
            <tbody>{room.players.map(renderPlayerRow)}</tbody>
          </table>

          <button className="danger" onClick={leaveRoom}>나가기</button>
        </section>
      )}
    </div>
  )
}

export default App
