import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3000');
ws.on('open', () => {
  const gameId = 'TEST_GAME';
  
  ws.send(JSON.stringify({ type: 'SUBSCRIBE', gameId }));

  ws.send(JSON.stringify({
    type: 'CREATE_GAME',
    gameId,
    state: {
      gameId, hostId: 'p1', phase: 'VOTING', currentRound: 1, totalRounds: 3,
      topicIndex: 0, secretWordIndex: 0, diceYellow: 1, diceBlue: 1,
      kiwiId: 'p2', codeCardSetIndex: 0, turnOrder: ['p1', 'p2'], currentTurnIndex: 0,
      kiwiGuess: '', roundHistory: [], createdAt: Date.now(),
      players: {
        'p1': { id: 'p1', name: 'p1', score: 0, clue: 'c', vote: '', hasSubmitted: true, isHost: true, isConnected: true },
        'p2': { id: 'p2', name: 'p2', score: 0, clue: 'c', vote: 'p1', hasSubmitted: true, isHost: false, isConnected: true }
      }
    }
  }));

  setTimeout(() => {
    ws.send(JSON.stringify({
      type: 'UPDATE_PLAYER',
      gameId,
      playerId: 'p1',
      updates: { vote: 'p2' }
    }));
  }, 200);

  setTimeout(() => {
    ws.close();
  }, 1000);
});
ws.on('message', (msg) => {
  const data = JSON.parse(msg.toString());
  if (data.type === 'GAME_STATE' && data.state?.roundHistory?.length > 0) {
    console.log('Server response roundHistory:', JSON.stringify(data.state.roundHistory, null, 2));
  }
});
