// const WebSocket = require('ws')
import { WebSocketServer, WebSocket } from 'ws'

const wss = new WebSocketServer({ port: 4000,
  host: '0.0.0.0'
})
const rooms = new Map()
const clients = new Map()

function createId() {
  return Math.random().toString(36).slice(2, 10)
}

function send(ws, type, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }))
  }
}

function serializeRoom(room) {
  return {
    id: room.id,
    hostId: room.hostId,
    hostName: room.hostName,
    status: room.status,
    target: room.target,
    mean: room.mean,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      submitted: player.submitted,
      number: room.status === 'ended' ? player.number : null,
      isPreliminary: player.isPreliminary,
      isWinner: player.isWinner,
    })),
  }
}

function broadcast(room, message) {
  const payload = { room: serializeRoom(room), message }
  room.clients.forEach((client) => {
    send(client, 'roomState', payload)
  })
}

function computeResult(room) {
  const active = room.players.filter((player) => player.submitted)
  if (active.length === 0) {
    room.message = '숫자가 하나도 제출되지 않았습니다. 다시 입력하세요.'
    return
  }

  const sorted = [...active].sort((a, b) => a.number - b.number)
  const count = sorted.length
  const mid = Math.floor(count / 2)
  const median = count % 2 === 1
    ? sorted[mid].number
    : (sorted[mid - 1].number + sorted[mid].number) / 2

  const mean = active.reduce((sum, p) => sum + p.number, 0) / active.length

  // 중앙값에 가장 가까운 예비 승리자 선정
  let minMedianDelta = Number.POSITIVE_INFINITY
  let preliminary = []

  sorted.forEach((player) => {
    const delta = Math.abs(player.number - median)
    if (delta < minMedianDelta - 1e-9) {
      minMedianDelta = delta
      preliminary = [player]
    } else if (Math.abs(delta - minMedianDelta) < 1e-9) {
      preliminary.push(player)
    }
  })

  const preliminaryIds = preliminary.map((p) => p.id)
  room.players.forEach((player) => {
    player.isPreliminary = preliminaryIds.includes(player.id)
  })

  // 최종 승리자 결정
  let finalWinners
  let usedMean = false

  if (preliminary.length === 1) {
    finalWinners = preliminary
  } else {
    usedMean = true

    // 평균에 가장 가까운 사람 선정
    let minMeanDelta = Number.POSITIVE_INFINITY
    let closestToMean = []
    preliminary.forEach((player) => {
      const delta = Math.abs(player.number - mean)
      if (delta < minMeanDelta - 1e-9) {
        minMeanDelta = delta
        closestToMean = [player]
      } else if (Math.abs(delta - minMeanDelta) < 1e-9) {
        closestToMean.push(player)
      }
    })

    if (closestToMean.length === 1) {
      finalWinners = closestToMean
    } else {
      // 평균에서도 동률이면 평균보다 작은 숫자가 승리
      // 숫자가 완전히 같은 경우에만 공동 승리
      const belowMean = closestToMean.filter((p) => p.number < mean - 1e-9)
      finalWinners = belowMean.length > 0 ? belowMean : closestToMean
    }
  }

  const winnerIds = finalWinners.map((p) => p.id)
  room.players.forEach((player) => {
    player.isWinner = winnerIds.includes(player.id)
  })
  room.target = median
  room.mean = mean
  room.status = 'ended'
  room.message = usedMean
    ? `중앙값 ${median} 동률 → 평균 ${mean.toFixed(2)} 기준으로 승자를 결정했습니다.`
    : `중앙값 ${median}에 가장 가까운 참가자가 승리했습니다.`
}

function createRoom(roomId, hostId, hostName, client) {
  const room = {
    id: roomId,
    hostId,
    hostName,
    status: 'playing',
    target: null,
    players: [],
    stopped: false,
    clients: new Set([client]),
    message: '게임이 시작되었습니다. 숫자를 입력하세요.',
  }
  rooms.set(roomId, room)
  return room
}

function handleCreate(ws, payload) {
  const roomId = payload.roomId || 'room1'
  const name = payload.name || '익명'
  const playerId = createId()

  if (rooms.has(roomId)) {
    send(ws, 'error', { message: `방 번호 "${roomId}"는 이미 존재합니다.` })
    return
  }

  const room = createRoom(roomId, playerId, name, ws)
  const player = {
    id: playerId,
    name,
    submitted: false,
    number: null,
    isWinner: false,
  }

  room.players.push(player)
  clients.set(ws, { roomId, playerId, name })

  send(ws, 'joined', { playerId, room: serializeRoom(room) })
  broadcast(room, room.message)
}

function joinRoom(ws, payload) {
  const roomId = payload.roomId || 'room1'
  const name = payload.name || '익명'
  const room = rooms.get(roomId)
  const playerId = createId()

  if (!room) {
    send(ws, 'error', { message: `방 번호 "${roomId}"를 찾을 수 없습니다.` })
    return
  }

  room.clients.add(ws)
  room.message = `${name}님이 방에 참가했습니다.`

  const player = {
    id: playerId,
    name,
    submitted: false,
    number: null,
    isWinner: false,
  }

  room.players.push(player)
  clients.set(ws, { roomId, playerId, name })

  send(ws, 'joined', { playerId, room: serializeRoom(room) })
  broadcast(room, room.message)
}

function submitNumber(ws, payload) {
  const meta = clients.get(ws)
  if (!meta) return
  const room = rooms.get(meta.roomId)
  if (!room || room.status !== 'playing') {
    send(ws, 'error', { message: '현재 게임에 참여할 수 없습니다.' })
    return
  }

  const player = room.players.find((p) => p.id === meta.playerId)
  if (!player || player.submitted) {
    send(ws, 'error', { message: '숫자를 이미 제출했거나 참가자를 찾을 수 없습니다.' })
    return
  }

  const number = Number(payload.number)
  if (Number.isNaN(number)) {
    send(ws, 'error', { message: '유효한 숫자를 입력해주세요.' })
    return
  }

  player.number = number
  player.submitted = true
  room.message = `${player.name}님이 숫자를 제출했습니다.`

  const allSubmitted = room.players.every((p) => p.submitted)
  if (allSubmitted || room.stopped) {
    computeResult(room)
  }

  broadcast(room, room.message)
}

function stopGame(ws) {
  const meta = clients.get(ws)
  if (!meta) return
  const room = rooms.get(meta.roomId)
  if (!room || room.hostId !== meta.playerId) {
    send(ws, 'error', { message: '호스트만 정지 버튼을 사용할 수 있습니다.' })
    return
  }

  room.stopped = true
  room.message = '호스트가 게임을 중지했습니다. 제출된 숫자들로 승자를 결정합니다.'
  computeResult(room)
  broadcast(room, room.message)
}

function resetGame(ws) {
  const meta = clients.get(ws)
  if (!meta) return
  const room = rooms.get(meta.roomId)
  if (!room || room.hostId !== meta.playerId) {
    send(ws, 'error', { message: '호스트만 게임을 다시 시작할 수 있습니다.' })
    return
  }
  room.status = 'playing'
  room.target = null
  room.stopped = false
  room.message = '새 게임이 시작되었습니다. 숫자를 입력해주세요.'
  room.players.forEach((player) => {
    player.submitted = false
    player.number = null
    player.isPreliminary = false
    player.isWinner = false
  })
  broadcast(room, room.message)
}

function leaveRoom(ws) {
  const meta = clients.get(ws)
  if (!meta) return
  const room = rooms.get(meta.roomId)
  clients.delete(ws)
  if (!room) return

  room.clients.delete(ws)
  room.players = room.players.filter((player) => player.id !== meta.playerId)

  if (room.hostId === meta.playerId && room.players.length > 0) {
    room.hostId = room.players[0].id
    room.hostName = room.players[0].name
    room.message = '호스트가 나갔습니다. 새 호스트가 지정되었습니다.'
  }

  if (room.players.length === 0) {
    rooms.delete(room.id)
    return
  }

  broadcast(room, room.message)
}

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    let data
    try {
      data = JSON.parse(message)
    } catch (err) {
      send(ws, 'error', { message: '메시지 형식이 잘못되었습니다.' })
      return
    }

    const { type, payload } = data
    switch (type) {
      case 'create':
        handleCreate(ws, payload)
        break
      case 'join':
        joinRoom(ws, payload)
        break
      case 'submit':
        submitNumber(ws, payload)
        break
      case 'stop':
        stopGame(ws)
        break
      case 'reset':
        resetGame(ws)
        break
      default:
        send(ws, 'error', { message: '알 수 없는 명령입니다.' })
    }
  })

  ws.on('close', () => leaveRoom(ws))
})

console.log('middle number 서버가 4000 포트에서 실행 중입니다.')
