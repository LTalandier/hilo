const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

// Set up Express
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Game State
const games = {};

// Card generation
function generateCards() {
  const cards = [];
  const colors = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'teal', 'pink'];
  
  for (const color of colors) {
    for (let num = -1; num <= 11; num++) {
      cards.push({ color, number: num });
    }
  }
  
  return cards;
}

// Shuffle array
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Initialize a new game
function createNewGame(gameId) {
  console.log(`[Game ${gameId}] Creating new game.`);
  const cards = shuffleArray(generateCards());
  
  const game = {
    id: gameId,
    players: [],
    drawPile: cards,
    discardPile: [],
    rounds: 0,
    maxRounds: 3, // Example: 3 rounds per game
    scores: {}, // Store scores across rounds
    playersReady: 0,
    playerGrids: {}, // Store each player's personal grid
    currentPlayerIndex: 0,
    gameStarted: false,
    gamePhase: 'setup', // Add a game phase: 'setup', 'play'
    drawnCardPreview: {}, // Store card being previewed by player ID
    lastRoundTriggered: false, // Flag for the final round sequence
    roundTriggererId: null, // ID of the player who triggered the end of round
  };
  
  games[gameId] = game;
  console.log(`[Game ${gameId}] Game created successfully.`);
  return game;
}

// Send updates about all player grids to all clients
function sendAllPlayerGrids(gameId) {
  const game = games[gameId];
  if (!game) return; // Safety check
  
  // console.log(`[Game ${gameId}] Sending all player grids update.`); // Can be noisy, uncomment if needed
  io.to(gameId).emit('allPlayerGrids', {
    playerGrids: createPlayerGridsData(game),
    players: game.players,
    currentPlayer: game.players[game.currentPlayerIndex]
  });
}

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);
  
  // Join game
  socket.on('joinGame', (gameId, playerName) => {
    let game = games[gameId];
    
    if (!game) {
      console.log(`[Game ${gameId}] No existing game found. Creating new one for player ${playerName || 'Unknown'} (ID: ${socket.id}).`);
      game = createNewGame(gameId);
    }
    
    if (game.gameStarted) {
      console.log(`[Game ${gameId}] Player ${playerName || 'Unknown'} (ID: ${socket.id}) attempting to join already started game.`);
      socket.emit('error', 'Game already started');
      return;
    }
    
    if (game.players.length >= 6) {
      console.log(`[Game ${gameId}] Player ${playerName || 'Unknown'} (ID: ${socket.id}) attempting to join full game.`);
      socket.emit('error', 'Game is full');
      return;
    }
    
    const player = {
      id: socket.id,
      name: playerName || `Player ${game.players.length + 1}`,
      scorePile: [],
      score: 0,
      roundScore: 0,
      ready: false,
      mustFlipCard: false,
      awaitingShiftChoice: false,
      pendingAlignmentIndices: null
    };
    
    game.players.push(player);
    socket.join(gameId);
    console.log(`[Game ${gameId}] Player ${player.name} (ID: ${socket.id}) joined. Total players: ${game.players.length}`);
    
    // Determine max rounds based on player count
    if (game.players.length >= 5) {
      game.maxRounds = 3;
    } else if (game.players.length >= 3) {
      game.maxRounds = 2;
    } else {
      game.maxRounds = 1;
    }
    console.log(`[Game ${gameId}] Max rounds set to ${game.maxRounds} based on player count.`);
    
    socket.emit('joinedGame', { gameId, player });
    io.to(gameId).emit('updatePlayers', game.players);
    
    // If 2 or more players have joined, allow starting the game
    if (game.players.length >= 2) {
      console.log(`[Game ${gameId}] Enabling start game option for player ${game.players[0].name}.`);
      io.to(game.players[0].id).emit('readyToStart', true);
    }
  });
  
  // Start game
  socket.on('startGame', (gameId) => {
    const game = games[gameId];
    
    if (!game || game.gameStarted) {
        console.log(`[Game ${gameId}] Ignoring start game request: Game not found or already started.`);
        return;
    }
    if (game.players.length < 2) {
        console.log(`[Game ${gameId}] Ignoring start game request: Not enough players (${game.players.length}).`);
        return;
    }
    
    console.log(`[Game ${gameId}] Starting game requested by ${socket.id}.`);
    game.gameStarted = true;
    game.gamePhase = 'setup';
    game.rounds++;
    console.log(`[Game ${gameId}] Starting Round ${game.rounds}. Phase: ${game.gamePhase}.`);
    
    // Initialize player grids with face-down cards
    game.players.forEach(player => {
      const playerCards = [];
      for (let i = 0; i < 9; i++) {
        if (game.drawPile.length > 0) {
          const card = game.drawPile.pop();
          card.faceDown = true; // Mark card as face down
          playerCards.push(card);
        }
      }
      game.playerGrids[player.id] = playerCards;
      console.log(`[Game ${gameId}] Dealt 9 cards to ${player.name}.`);
    });
    
    // Move first card to discard pile
    const discardStartCard = game.drawPile.pop();
    game.discardPile.push(discardStartCard);
    console.log(`[Game ${gameId}] Moved card ${discardStartCard.number} ${discardStartCard.color} to discard pile.`);
    
    // Send initial game state to all players
    console.log(`[Game ${gameId}] Emitting 'gameStarted' to all players.`);
    io.to(gameId).emit('gameStarted', {
      gamePhase: game.gamePhase,
      drawPile: game.drawPile.length,
      discardPile: game.discardPile,
      currentPlayer: game.players[game.currentPlayerIndex],
      players: game.players,
      playerGrids: createPlayerGridsData(game)
    });
    
    // Send each player their specific grid
    game.players.forEach(player => {
      io.to(player.id).emit('playerGridUpdate', {
        playerGrid: game.playerGrids[player.id] || []
      });
    });
    
    // Send all player grids for status display
    sendAllPlayerGrids(gameId);
  });
  
  // Flip card (used in Setup and Play phases)
  socket.on('flipCard', (gameId, cardIndex) => {
    const game = games[gameId];
    
    if (!game || !game.gameStarted) {
        console.log(`[Game ${gameId}] Ignoring flipCard request: Game not found or not started.`);
        return; // General check
    }

    const currentPlayer = game.players.find(p => p.id === socket.id);
    if (!currentPlayer) {
        console.log(`[Game ${gameId}] Ignoring flipCard request: Player ${socket.id} not found.`);
        return; // Player not found?
    }
    
    const playerGrid = game.playerGrids[socket.id];
    if (!playerGrid) {
        console.log(`[Game ${gameId}] Ignoring flipCard request: Grid not found for player ${socket.id}.`);
        return;
    }
    
    // --- Setup Phase Logic ---
    if (game.gamePhase === 'setup') {
      console.log(`[Game ${gameId}] Player ${currentPlayer.name} trying to flip card at index ${cardIndex} during setup.`);
      // Check if card exists and is face down
      if (cardIndex >= 0 && cardIndex < playerGrid.length && playerGrid[cardIndex].faceDown) {
        playerGrid[cardIndex].faceDown = false;
        console.log(`[Game ${gameId}] Player ${currentPlayer.name} successfully flipped card at index ${cardIndex} (now ${playerGrid[cardIndex].number} ${playerGrid[cardIndex].color}).`);
        
        // Count how many cards player has flipped
        const flippedCount = playerGrid.filter(card => !card.faceDown).length;
        console.log(`[Game ${gameId}] Player ${currentPlayer.name} has flipped ${flippedCount} cards.`);
        
        // If player has flipped 2 cards, mark them as ready
        if (flippedCount === 2) {
          // Check if this player wasn't already counted as ready
          const playerAlreadyReady = game.players.find(p => p.id === socket.id && p.ready);
          if (!playerAlreadyReady) {
            game.playersReady++;
            currentPlayer.ready = true; // Mark this player as ready
            console.log(`[Game ${gameId}] Player ${currentPlayer.name} is now ready. Total ready: ${game.playersReady}/${game.players.length}`);
          }
          
          // Check if all players are ready to start playing phase
          if (game.playersReady === game.players.length) {
            // --- START: Determine starting player based on highest flipped card sum ---
            console.log(`[Game ${gameId}][Setup End] All ${game.players.length} players ready. Determining starting player...`); // Added log
            let highestSum = -Infinity; // Initialize with a very low number
            let startingPlayerIndex = 0; // Default to player 0 if sums are equal or negative

            game.players.forEach((player, index) => {
              const playerGrid = game.playerGrids[player.id];
              if (playerGrid) {
                const flippedCards = playerGrid.filter(card => !card.faceDown);
                // Ensure exactly two cards were flipped as expected
                if (flippedCards.length === 2) { 
                    const currentSum = flippedCards.reduce((sum, card) => sum + (card.number || 0), 0); // Use card.number, default to 0 if undefined
                    console.log(`[Game ${gameId}][Setup End] Player ${player.name} (Index: ${index}) flipped sum: ${currentSum}`); // Log each player's sum
                    
                    if (currentSum > highestSum) {
                        console.log(`[Game ${gameId}][Setup End] New highest sum found: ${currentSum} by Player ${player.name}. Previous highest: ${highestSum}`); // Log new highest
                        highestSum = currentSum;
                        startingPlayerIndex = index;
                    }
                    // Optional: Handle ties? Current logic picks the first player with the highest sum.
                } else {
                    console.warn(`[Game ${gameId}][Setup End] Player ${player.name} has ${flippedCards.length} cards flipped at end of setup, expected 2.`); // Warning log
                }
              } else {
                 console.warn(`[Game ${gameId}][Setup End] No grid found for player ${player.name} (ID: ${player.id}) during starting player determination.`); // Added warning log
              }
            });
            
            // Use optional chaining ?. for safety in case player doesn't exist at index
            console.log(`[Game ${gameId}][Setup End] Starting player determined: Index ${startingPlayerIndex} - ${game.players[startingPlayerIndex]?.name || 'Unknown'} with sum ${highestSum}`); // Log final result 
            game.currentPlayerIndex = startingPlayerIndex; 
            // --- END: Determine starting player ---

            game.gamePhase = 'play';
            console.log(`[Game ${gameId}] Transitioning to 'play' phase. Current player: ${game.players[game.currentPlayerIndex]?.name}.`);
            io.to(gameId).emit('playPhaseStarted', {
              currentPlayer: game.players[game.currentPlayerIndex], // This now uses the determined starting player
              players: game.players,
              playerGrids: createPlayerGridsData(game),
              round: game.rounds // Pass current round number
            });
          }
        } 
        
        // Update the player about their grid & flip count
        socket.emit('cardFlippedSetup', { // Use a distinct event for setup flip confirmation
          playerGrid: playerGrid,
          flippedCount: flippedCount
        });

        // Send updated player grid information to all clients
        sendAllPlayerGrids(gameId);
        // Don't end turn in setup
      } else {
         console.log(`[Game ${gameId}] Player ${currentPlayer.name} tried to flip invalid/face-up card at index ${cardIndex}.`);
         socket.emit('error', 'Invalid selection or card already face up.');
      }
      return; // End processing for setup phase
    }

    // --- Play Phase Logic ---
    if (game.gamePhase === 'play') {
       console.log(`[Game ${gameId}] Player ${currentPlayer.name} trying to flip card at index ${cardIndex} during play.`);
       // Check if it's the current player's turn
       if (socket.id !== game.players[game.currentPlayerIndex].id) {
         console.log(`[Game ${gameId}] Player ${currentPlayer.name} tried to flip card, but not their turn (Current: ${game.players[game.currentPlayerIndex].name}).`);
         socket.emit('error', 'Not your turn to flip');
         return;
       }

       // Ensure player is not in a preview state (drawing action)
       if (game.drawnCardPreview[socket.id]) {
           console.log(`[Game ${gameId}] Player ${currentPlayer.name} tried to flip card, but is currently previewing drawn card.`);
           socket.emit('error', 'Invalid action. Complete your draw action first.');
           return;
       }

       // Validate card selection
       if (typeof cardIndex !== 'number' || cardIndex < 0 || cardIndex >= playerGrid.length || !playerGrid[cardIndex] || !playerGrid[cardIndex].faceDown) {
         console.log(`[Game ${gameId}] Player ${currentPlayer.name} tried to flip invalid card index ${cardIndex} or card is already face-up.`);
         socket.emit('error', 'Must select a valid face-down card to flip.');
         return;
       }

       // Check if the flip is allowed based on player state
       // Rule 1: Flip is mandatory after draw & discard (mustFlipCard is true)
       // Rule 2: Flip is the chosen action for the turn (mustFlipCard is false)
       const isMandatoryFlip = currentPlayer.mustFlipCard;

       // If it's not a mandatory flip, ensure they haven't taken another action yet
       // (This check is implicitly handled by the !game.drawnCardPreview check above
       // and the client-side logic preventing multiple actions)

       // Perform the flip
       playerGrid[cardIndex].faceDown = false;
       console.log(`[Game ${gameId}] Player ${currentPlayer.name} flipped card at index ${cardIndex} (Mandatory: ${isMandatoryFlip}). Card: ${playerGrid[cardIndex].number} ${playerGrid[cardIndex].color}`);

       // Reset the flag if it was a mandatory flip
       if (isMandatoryFlip) {
           console.log(`[Game ${gameId}] Resetting mustFlipCard for ${currentPlayer.name}.`);
           currentPlayer.mustFlipCard = false;
       }

       // Check for alignments AFTER flipping the card
       const alignmentFound = checkForAlignments(gameId, socket.id);

       // If an alignment was found, the turn does NOT end here.
       // It ends after the player chooses the shift direction.
       if (!alignmentFound) {
           // ---- START: MOVED BLOCK ----
           // Check if this action completes the final round
           const nextPlayerIndexIfTurnEnds = (game.currentPlayerIndex + 1) % game.players.length;
           if (game.lastRoundTriggered && game.players[nextPlayerIndexIfTurnEnds].id === game.roundTriggererId) {
               console.log(`[Game ${gameId}] Last round completed by ${currentPlayer.name} flipping card (no alignment). Triggering end sequence.`);
               triggerRoundEndSequence(gameId); // Call the sequence function
               return; // Stop further execution in this handler
           }
           // ---- END: MOVED BLOCK ----

           // Advance to the next player ONLY if no alignment choice is pending
           console.log(`[Game ${gameId}] Turn ending for ${currentPlayer.name}. No alignment found after flip.`);
           game.currentPlayerIndex = nextPlayerIndexIfTurnEnds;
           console.log(`[Game ${gameId}] Next player: ${game.players[game.currentPlayerIndex]?.name}`);

           // Update game state for clients
           io.to(gameId).emit('gameUpdate', {
             drawPile: game.drawPile.length,
             discardPile: game.discardPile,
             currentPlayer: game.players[game.currentPlayerIndex],
             players: game.players,
             playerGrids: createPlayerGridsData(game) // Grid data potentially updated by alignment check
           });

           // Check if the round should end (only if turn advances)
           checkEndOfRound(gameId); 
       } else {
           console.log(`[Game ${gameId}] Alignment found for ${currentPlayer.name} after flip. Waiting for shift choice.`);
           // Alignment found, player needs to choose shift. Send updated grid data only.
           io.to(gameId).emit('gameUpdatePartial', { 
               playerGrids: createPlayerGridsData(game) // Show the grid before compaction
           });
       }
    } else {
        console.log(`[Game ${gameId}] Player ${currentPlayer.name} tried to flip card, but game phase is '${game.gamePhase}'.`);
        socket.emit('error', 'Cannot flip card in current game phase.');
    }
  });
  
  // Player requests to draw a card
  socket.on('requestDraw', (gameId) => {
    const game = games[gameId];
    if (!game || !game.gameStarted || game.gamePhase !== 'play') {
      console.log(`[Game ${gameId}] Ignoring requestDraw: Invalid state (Game: ${!!game}, Started: ${game?.gameStarted}, Phase: ${game?.gamePhase}).`);
      return;
    }

    const currentPlayer = game.players[game.currentPlayerIndex];
    if (socket.id !== currentPlayer.id) {
      console.log(`[Game ${gameId}] Player ${socket.id} tried to draw, but not their turn (Current: ${currentPlayer.name}).`);
      socket.emit('error', 'Not your turn');
      return;
    }

    // Check if player is already previewing a card or must flip
    if (game.drawnCardPreview[socket.id] || currentPlayer.mustFlipCard) {
        console.log(`[Game ${gameId}] Player ${currentPlayer.name} tried to draw, but already has action pending (Previewing: ${!!game.drawnCardPreview[socket.id]}, MustFlip: ${currentPlayer.mustFlipCard}).`);
        socket.emit('error', 'Invalid action. Complete your current action first.');
        return;
    }

    if (game.drawPile.length === 0) {
      console.log(`[Game ${gameId}] Player ${currentPlayer.name} tried to draw, but draw pile is empty.`);
      socket.emit('error', 'Draw pile is empty');
      // Potentially end round here if needed by rules (Handled by checkEndOfRound)
      checkEndOfRound(gameId); // Check if empty draw pile triggers end
      return;
    }

    const drawnCard = game.drawPile.pop();
    drawnCard.faceDown = false; // Ensure it's face up for preview
    game.drawnCardPreview[socket.id] = drawnCard;

    console.log(`[Game ${gameId}] Player ${currentPlayer.name} drew ${drawnCard.number} ${drawnCard.color} for preview. Draw pile size: ${game.drawPile.length}.`);

    // Send the drawn card only to the current player
    socket.emit('drawnCardPreview', {
      card: drawnCard,
      drawPile: game.drawPile.length // Update draw pile count for the player
    });

    // Notify other players that the draw pile decreased (optional)
    socket.to(gameId).emit('gameUpdatePartial', {
      drawPile: game.drawPile.length,
      // No change to discard, current player, or grids yet
    });
  });
  
  // Player decides what to do with the previewed drawn card
  socket.on('placeDrawnCard', (gameId, { action, gridIndex }) => {
    const game = games[gameId];
    if (!game || !game.gameStarted || game.gamePhase !== 'play') {
        console.log(`[Game ${gameId}] Ignoring placeDrawnCard: Invalid state.`);
        return;
    }

    const currentPlayer = game.players[game.currentPlayerIndex];
    if (socket.id !== currentPlayer.id) {
      console.log(`[Game ${gameId}] Player ${socket.id} tried placeDrawnCard, but not their turn.`);
      socket.emit('error', 'Not your turn');
      return;
    }

    // Check if player actually has a card being previewed
    const cardToPlace = game.drawnCardPreview[socket.id];
    if (!cardToPlace) {
        console.log(`[Game ${gameId}] Player ${currentPlayer.name} tried placeDrawnCard, but no card is being previewed.`);
        socket.emit('error', 'No card is being previewed.');
        return;
    }
    
    console.log(`[Game ${gameId}] Player ${currentPlayer.name} choosing action '${action}' for previewed card ${cardToPlace.number} ${cardToPlace.color}.`);

    // Clear the preview card state FIRST
    delete game.drawnCardPreview[socket.id];

    // Action 1: Discard the drawn card and must flip
    if (action === 'discardAndFlip') {
      game.discardPile.push(cardToPlace);
      console.log(`[Game ${gameId}] Player ${currentPlayer.name} discarded previewed card ${cardToPlace.number} ${cardToPlace.color}. Must flip. Discard top: ${game.discardPile[game.discardPile.length-1]?.number} ${game.discardPile[game.discardPile.length-1]?.color}.`);
      currentPlayer.mustFlipCard = true; // Set the flag
      
      // Send update to the player indicating they must flip
      socket.emit('mustFlip', {
          message: 'You discarded the drawn card. Select a face-down card from your grid to flip.',
          discardPile: game.discardPile, // Send updated discard pile
          playerGrids: createPlayerGridsData(game) // Send updated grids too
      });
      
      // Send a partial update to other players
      socket.to(gameId).emit('gameUpdatePartial', {
         discardPile: game.discardPile,
         playerGrids: createPlayerGridsData(game) 
      });
      // Turn does not end here
      return; 
    }

    // Action 2: Exchange the drawn card with a grid card
    if (action === 'exchangeWithGrid') {
      if (typeof gridIndex === 'undefined' || gridIndex === null) {
          console.log(`[Game ${gameId}] Player ${currentPlayer.name} chose exchangeWithGrid but provided no gridIndex.`);
          socket.emit('error', 'Grid index required for exchange.');
          // Put the card back? No, it was already removed from preview. Error is enough.
          return;
      }

      const playerGrid = game.playerGrids[socket.id];
      if (!playerGrid || typeof gridIndex !== 'number' || gridIndex < 0 || gridIndex >= playerGrid.length || !playerGrid[gridIndex]) {
          console.log(`[Game ${gameId}] Player ${currentPlayer.name} chose exchangeWithGrid with invalid index ${gridIndex}.`);
          socket.emit('error', 'Invalid grid position selected.');
          return;
      }
      
      const cardInGrid = playerGrid[gridIndex];
      console.log(`[Game ${gameId}] Player ${currentPlayer.name} exchanging previewed card ${cardToPlace.number} ${cardToPlace.color} with grid index ${gridIndex} (Card: ${cardInGrid.number} ${cardInGrid.color}).`);

      // Place the drawn card into the player's grid
      playerGrid[gridIndex] = { ...cardToPlace, faceDown: false }; // It was already faceup
      // Put the card that was in the grid onto the discard pile
      game.discardPile.push(cardInGrid);
      console.log(`[Game ${gameId}] Discarded card ${cardInGrid.number} ${cardInGrid.color} from grid. Discard top: ${game.discardPile[game.discardPile.length-1]?.number} ${game.discardPile[game.discardPile.length-1]?.color}.`);

      // Check for alignments BEFORE ending the turn
      const alignmentFound = checkForAlignments(gameId, socket.id);
      
      // If an alignment was found, the turn does NOT end here. 
      // It ends after the player chooses the shift direction.
      if (!alignmentFound) {
           // ---- START: MOVED BLOCK ----
           // Check if this action completes the final round
           const nextPlayerIndexIfTurnEnds = (game.currentPlayerIndex + 1) % game.players.length;
           if (game.lastRoundTriggered && game.players[nextPlayerIndexIfTurnEnds].id === game.roundTriggererId) {
               console.log(`[Game ${gameId}] Last round completed by ${currentPlayer.name} exchanging drawn card (no alignment). Triggering end sequence.`);
               triggerRoundEndSequence(gameId); // Call the sequence function
               return; // Stop further execution in this handler
           }
           // ---- END: MOVED BLOCK ----

           // Advance to the next player ONLY if no alignment choice is pending
           console.log(`[Game ${gameId}] Turn ending for ${currentPlayer.name}. No alignment found after drawn exchange.`);
           game.currentPlayerIndex = nextPlayerIndexIfTurnEnds;
           console.log(`[Game ${gameId}] Next player: ${game.players[game.currentPlayerIndex]?.name}`);

           // Update game state for clients
           io.to(gameId).emit('gameUpdate', {
             drawPile: game.drawPile.length,
             discardPile: game.discardPile,
             currentPlayer: game.players[game.currentPlayerIndex],
             players: game.players,
             playerGrids: createPlayerGridsData(game) 
           });

           // Check if the round should end (only if turn advances)
           checkEndOfRound(gameId); 
      } else {
           console.log(`[Game ${gameId}] Alignment found for ${currentPlayer.name} after drawn exchange. Waiting for shift choice.`);
           // Alignment found, player needs to choose shift. Send updated grid data only.
           io.to(gameId).emit('gameUpdatePartial', { 
               playerGrids: createPlayerGridsData(game) // Show the grid before compaction
           });
      }
      return;
    }

    // Invalid action
    console.log(`[Game ${gameId}] Player ${currentPlayer.name} submitted invalid action '${action}' for placeDrawnCard.`);
    socket.emit('error', 'Invalid action specified for placing drawn card.');
  });
  
  // Place a card (Only for Discard -> Grid exchange)
  socket.on('placeCard', (gameId, { source, gridIndex }) => {
    const game = games[gameId];
    
    if (!game || !game.gameStarted || game.gamePhase !== 'play') {
      console.log(`[Game ${gameId}] Ignoring placeCard: Invalid state.`);
      return;
    }
    
    const currentPlayer = game.players[game.currentPlayerIndex];
    if (socket.id !== currentPlayer.id) {
      console.log(`[Game ${gameId}] Player ${socket.id} tried placeCard, but not their turn.`);
      socket.emit('error', 'Not your turn');
      return;
    }

    // Ensure player is not in a mustFlip or preview state
     if (currentPlayer.mustFlipCard || game.drawnCardPreview[socket.id]) {
        console.log(`[Game ${gameId}] Player ${currentPlayer.name} tried placeCard, but has action pending (Previewing: ${!!game.drawnCardPreview[socket.id]}, MustFlip: ${currentPlayer.mustFlipCard}).`);
        socket.emit('error', 'Invalid action. Complete your current action first.');
        return;
    }
    
    // This handler is ONLY for taking from discard now
    if (source !== 'discard') {
        console.log(`[Game ${gameId}] Player ${currentPlayer.name} called placeCard with invalid source '${source}'.`);
        socket.emit('error', 'Invalid source for placeCard. Use requestDraw/placeDrawnCard for draw pile actions.');
        return;
    }

    if (game.discardPile.length === 0) {
      console.log(`[Game ${gameId}] Player ${currentPlayer.name} tried to take from empty discard pile.`);
      socket.emit('error', 'Discard pile is empty');
      return;
    }
    
    // Taking from discard requires selecting a grid card
    if (typeof gridIndex === 'undefined' || gridIndex === null) {
        console.log(`[Game ${gameId}] Player ${currentPlayer.name} tried to take from discard without specifying gridIndex.`);
        socket.emit('error', 'Must select a grid card to exchange with discard pile card');
        return;
    }
    
    const cardToPlace = game.discardPile.pop();
    console.log(`[Game ${gameId}] Player ${currentPlayer.name} taking card ${cardToPlace.number} ${cardToPlace.color} from discard pile.`);
    
    // --- Exchange Logic ---
    const playerGrid = game.playerGrids[socket.id];
    if (!playerGrid || typeof gridIndex !== 'number' || gridIndex < 0 || gridIndex >= playerGrid.length || !playerGrid[gridIndex]) {
        console.log(`[Game ${gameId}] Player ${currentPlayer.name} tried to exchange discard card with invalid grid index ${gridIndex}.`);
        socket.emit('error', 'Invalid grid position selected');
        game.discardPile.push(cardToPlace); // Return card taken from discard
        console.log(`[Game ${gameId}] Returned card ${cardToPlace.number} ${cardToPlace.color} to discard pile.`);
        return;
    }

    const cardInGrid = playerGrid[gridIndex];
    
    console.log(`[Game ${gameId}] Player ${currentPlayer.name} exchanging discard card ${cardToPlace.number} ${cardToPlace.color} with grid index ${gridIndex} (Card: ${cardInGrid.number} ${cardInGrid.color}).`);

    // Place the discard card into the player's grid
    playerGrid[gridIndex] = { ...cardToPlace, faceDown: false };
    // Put the card that was in the grid onto the discard pile
    game.discardPile.push(cardInGrid);
    console.log(`[Game ${gameId}] Discarded card ${cardInGrid.number} ${cardInGrid.color} from grid. Discard top: ${game.discardPile[game.discardPile.length-1]?.number} ${game.discardPile[game.discardPile.length-1]?.color}.`);


    // Check for alignments BEFORE ending the turn
    const alignmentFound = checkForAlignments(gameId, socket.id);
    
    // Check if this action completes the final round
    const nextPlayerIndexIfTurnEnds = (game.currentPlayerIndex + 1) % game.players.length;
    if (game.lastRoundTriggered && game.players[nextPlayerIndexIfTurnEnds].id === game.roundTriggererId) {
        console.log(`[Game ${gameId}] Last round completed by ${currentPlayer.name} exchanging discard card (no alignment). Triggering end sequence.`);
        triggerRoundEndSequence(gameId); // Call the sequence function
        return; // Stop further execution in this handler
    }
    
    // If an alignment was found, the turn does NOT end here. 
    // It ends after the player chooses the shift direction.
    if (!alignmentFound) {
       // ---- START: MOVED BLOCK ----
       // Check if this action completes the final round
       const nextPlayerIndexIfTurnEnds = (game.currentPlayerIndex + 1) % game.players.length;
       if (game.lastRoundTriggered && game.players[nextPlayerIndexIfTurnEnds].id === game.roundTriggererId) {
           console.log(`[Game ${gameId}] Last round completed by ${currentPlayer.name} exchanging discard card (no alignment). Triggering end sequence.`);
           triggerRoundEndSequence(gameId); // Call the sequence function
           return; // Stop further execution in this handler
       }
       // ---- END: MOVED BLOCK ----

       // Advance to the next player ONLY if no alignment choice is pending
       console.log(`[Game ${gameId}] Turn ending for ${currentPlayer.name}. No alignment found after discard exchange.`);
       game.currentPlayerIndex = nextPlayerIndexIfTurnEnds;
       console.log(`[Game ${gameId}] Next player: ${game.players[game.currentPlayerIndex]?.name}`);

       // Update game state for clients
       io.to(gameId).emit('gameUpdate', {
         drawPile: game.drawPile.length,
         discardPile: game.discardPile,
         currentPlayer: game.players[game.currentPlayerIndex],
         players: game.players,
         playerGrids: createPlayerGridsData(game) 
       });

       // Check if the round should end (only if turn advances)
       checkEndOfRound(gameId); 
    } else {
        console.log(`[Game ${gameId}] Alignment found for ${currentPlayer.name} after discard exchange. Waiting for shift choice.`);
        // Alignment found, player needs to choose shift. Send updated grid data only.
       io.to(gameId).emit('gameUpdatePartial', { 
           playerGrids: createPlayerGridsData(game) // Show the grid before compaction
       });
    }
  });
  
  // NEW FUNCTION: Check for and handle alignments
  function checkForAlignments(gameId, playerId) {
    const game = games[gameId];
    if (!game) return false;
    
    const player = game.players.find(p => p.id === playerId);
    const playerGrid = game.playerGrids[playerId];
    if (!player || !playerGrid || playerGrid.length === 0) return false;

    console.log(`[Game ${gameId}] Checking alignments for player ${player.name} (ID: ${playerId}).`);
    
    // Separate patterns by type
    const rowPatterns = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8]
    ];
    const colPatterns = [
      [0, 3, 6], [1, 4, 7], [2, 5, 8]
    ];
    const diagPatterns = [
      [0, 4, 8], [2, 4, 6]
    ];
    const allPatterns = [...rowPatterns, ...colPatterns, ...diagPatterns];

    const indicesToRemove = new Set();
    let foundRowAlignment = false;
    let foundColAlignment = false;
    let foundDiagAlignment = false;
    const alignedCards = []; // Store the actual cards to be discarded

    // Helper to check a pattern and update flags/indices
    const checkPattern = (pattern, type) => {
        const validIndices = pattern.every(index => index < playerGrid.length);
        if (!validIndices) return false;

        const [i1, i2, i3] = pattern;
        const card1 = playerGrid[i1];
        const card2 = playerGrid[i2];
        const card3 = playerGrid[i3];

        // Check if all cards exist, are face up, and have the same color
        if (card1 && card2 && card3 && 
            !card1.faceDown && !card2.faceDown && !card3.faceDown &&
            card1.color === card2.color && card1.color === card3.color) 
        {
            console.log(`[Game ${gameId}] Alignment DETECTED (${type}) for player ${playerId} at indices: ${i1}, ${i2}, ${i3}. Cards: ${card1.number} ${card1.color}, ${card2.number} ${card2.color}, ${card3.number} ${card3.color}`);
            
            // Add indices only if they aren't already marked (prevents duplicates if cards are part of multiple alignments)
            if (!indicesToRemove.has(i1)) {
                 indicesToRemove.add(i1);
                 alignedCards.push(card1); // Add the card itself
            }
            if (!indicesToRemove.has(i2)) {
                indicesToRemove.add(i2);
                alignedCards.push(card2); // Add the card itself
            }
            if (!indicesToRemove.has(i3)) {
                indicesToRemove.add(i3);
                alignedCards.push(card3); // Add the card itself
            }
            return true; // Alignment found for this pattern
        }
        return false;
    };

    // Check all patterns and update flags
    rowPatterns.forEach(p => { if (checkPattern(p, 'Row')) foundRowAlignment = true; });
    colPatterns.forEach(p => { if (checkPattern(p, 'Column')) foundColAlignment = true; });
    diagPatterns.forEach(p => { if (checkPattern(p, 'Diagonal')) foundDiagAlignment = true; });

    // --- NEW: Discard aligned cards before compaction ---
    if (alignedCards.length > 0) {
        // Sort cards by number in descending order (highest number first)
        alignedCards.sort((a, b) => b.number - a.number); 
        
        // Push onto discard pile (lowest number ends up on top)
        game.discardPile.push(...alignedCards); 
        console.log(`[Game ${gameId}] Player ${playerId} discarding aligned cards:`, alignedCards.map(c => `${c.number} ${c.color}`).join(', ') + `. Discard top: ${game.discardPile[game.discardPile.length-1]?.number} ${game.discardPile[game.discardPile.length-1]?.color}.`);
    }
    // --- End NEW ---

    if (indicesToRemove.size === 0) {
        console.log(`[Game ${gameId}] No alignments found for player ${playerId}.`);
        return false; // No alignments found
    }

    // If diagonal alignment exists, always prompt for choice
    if (foundDiagAlignment) {
        console.log(`[Game ${gameId}] Diagonal alignment found for player ${playerId}. Prompting for shift choice. Indices:`, Array.from(indicesToRemove));
        player.awaitingShiftChoice = true;
        player.pendingAlignmentIndices = Array.from(indicesToRemove); 
        io.to(playerId).emit('promptShiftChoice', {
            message: 'Diagonal alignment found! Choose shift direction.',
            indices: player.pendingAlignmentIndices
        });
        return true; // Pause the turn
    }
     
    // If only Row or Column alignments (no diagonal), compact directly
    console.log(`[Game ${gameId}] Non-diagonal alignment found for player ${playerId}. Compacting automatically (vertical shift). Indices:`, Array.from(indicesToRemove));

    // --- Start: Adapted Compaction Logic (Vertical Shift) ---
    const ROWS = 3;
    const COLS = 3;
    let newGrid = Array(ROWS * COLS).fill(null); 

    // Create a 2D representation
    let grid2D = Array(ROWS).fill(null).map(() => Array(COLS).fill(null));
    for(let i = 0; i < playerGrid.length; i++) {
        // Check if index is valid before accessing playerGrid[i]
        if (i >= 0 && i < (ROWS * COLS)) { 
            const row = Math.floor(i / COLS);
            const col = i % COLS;
            grid2D[row][col] = indicesToRemove.has(i) ? null : playerGrid[i]; 
        } else {
            console.warn(`[Game ${gameId}] Invalid index ${i} encountered during 2D grid creation for shift.`);
        }
    }
    console.log(`[Game ${gameId}] checkForAlignments (Automatic): 2D grid before shift:`, JSON.stringify(grid2D)); // Log before automatic shift

    // Perform Vertical Shift (Shift UP) - This is the only automatic direction
    console.log(`[Game ${gameId}] Performing automatic vertical compaction (shifting UP).`);
    for (let c = 0; c < COLS; c++) {
        let writeRow = 0; // Start writing from the top row
        for (let r = 0; r < ROWS; r++) {
            if (grid2D[r][c] !== null) { // If there's a card at [r][c]
                if (r !== writeRow) { // If it's not already in the correct position
                    grid2D[writeRow][c] = grid2D[r][c]; // Move the card up
                    grid2D[r][c] = null; // Clear the original position
                }
                 writeRow++; // Move to the next available slot in this column
            }
        }
    }
    console.log(`[Game ${gameId}] checkForAlignments (Automatic): 2D grid after shift:`, JSON.stringify(grid2D)); // Log after automatic shift

    // Convert the shifted 2D grid back to a 1D array
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const index1D = (r * COLS) + c;
            newGrid[index1D] = grid2D[r][c]; 
        }
    }
    console.log(`[Game ${gameId}] checkForAlignments (Automatic): 1D grid after conversion:`, JSON.stringify(newGrid)); // Log after conversion

    // Update the player's grid
    game.playerGrids[playerId] = newGrid;
    const remainingCardCount = newGrid.filter(Boolean).length;
    console.log(`[Game ${gameId}] Grid for player ${playerId} automatically compacted (vertical) to ${remainingCardCount} cards.`);

    // NOW the turn ends. Check for last round completion *before* advancing index.
    const nextPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
    console.log(`[Game ${gameId}] checkForAlignments (Automatic): Checking last round condition. LastRoundTriggered: ${game.lastRoundTriggered}, NextPlayerID: ${game.players[nextPlayerIndex]?.id}, TriggererID: ${game.roundTriggererId}`);
    if (game.lastRoundTriggered && game.players[nextPlayerIndex].id === game.roundTriggererId) {
        console.log(`[Game ${gameId}] Last round completed by ${player.name} after automatic compaction. Triggering end sequence.`);
        triggerRoundEndSequence(gameId); // Call the sequence function
        return; // Stop further execution
    }

    // Advance turn
    console.log(`[Game ${gameId}] Turn ending for ${player.name} after automatic compaction.`);
    game.currentPlayerIndex = nextPlayerIndex;
    console.log(`[Game ${gameId}] Next player: ${game.players[game.currentPlayerIndex]?.name} (Index: ${game.currentPlayerIndex})`);


    // Send final game update after compaction and turn advance
    console.log(`[Game ${gameId}] checkForAlignments (Automatic): Emitting gameUpdate.`); // Add log
    io.to(gameId).emit('gameUpdate', {
      drawPile: game.drawPile.length,
      discardPile: game.discardPile,
      currentPlayer: game.players[game.currentPlayerIndex],
      players: game.players,
      playerGrids: createPlayerGridsData(game) 
    });

    // Check for end of round conditions (e.g., empty grid after compaction)
    console.log(`[Game ${gameId}] checkForAlignments (Automatic): Calling checkEndOfRound.`); // Add log
    checkEndOfRound(gameId);

    // Return true because an alignment was found and handled (automatically).
    // This prevents the calling function (placeCard, flipCard, etc.) from
    // advancing the turn again.
    return true; 
  }

  // Handle player's choice for shifting after alignment
  socket.on('submitShiftChoice', (gameId, direction) => {
    console.log(`[Game ${gameId}] Received 'submitShiftChoice' event with direction: ${direction}`); // Add this log FIRST
    const game = games[gameId];
    if (!game || !game.gameStarted) {
        console.log(`[Game ${gameId}] Ignoring submitShiftChoice: Invalid state.`);
        return; 
    }

    const player = game.players.find(p => p.id === socket.id);

    // Validate: Is it this player's turn? Are they awaiting choice? Is direction valid?
    if (!player || socket.id !== game.players[game.currentPlayerIndex].id || !player.awaitingShiftChoice || !['horizontal', 'vertical'].includes(direction)) {
        console.log(`[Game ${gameId}] Invalid submitShiftChoice. Player: ${player?.name}, Is Turn: ${socket.id === game.players[game.currentPlayerIndex].id}, Awaiting: ${player?.awaitingShiftChoice}, Direction: ${direction}.`);
        socket.emit('error', 'Invalid state or choice for shifting.');
        // Do NOT reset flags here, let them try again if it was just a bad direction
        return;
    }

    const playerGrid = game.playerGrids[socket.id];
    const indicesToRemove = new Set(player.pendingAlignmentIndices || []);

    if (indicesToRemove.size === 0 || !playerGrid) {
        console.error(`[Game ${gameId}] Error: Shift choice submitted by ${player.name} but no pending indices or grid found. Resetting state.`);
        // Reset state and attempt to proceed turn normally
        player.awaitingShiftChoice = false;
        player.pendingAlignmentIndices = null;
        // Consider advancing turn here if robust error recovery is needed
        // For now, just log the error and reset flags. Player might be stuck.
        socket.emit('error', 'Internal error processing shift choice. Please try another action or refresh.'); 
        return; 
    }

    console.log(`[Game ${gameId}] Player ${player.name} chose ${direction} shift for indices:`, Array.from(indicesToRemove));

    // --- Compaction Logic --- 
    const ROWS = 3;
    const COLS = 3;
    let newGrid = Array(ROWS * COLS).fill(null); 

    // Create a 2D representation for easier shifting logic
    let grid2D = Array(ROWS).fill(null).map(() => Array(COLS).fill(null));
    for(let i = 0; i < playerGrid.length; i++) {
        // Check if index is valid before accessing playerGrid[i] // Good check added previously
        if (i >= 0 && i < (ROWS * COLS)) { 
            const row = Math.floor(i / COLS);
            const col = i % COLS;
            // If the index is one to remove, set to null, otherwise copy the card (or existing null)
            grid2D[row][col] = indicesToRemove.has(i) ? null : playerGrid[i]; 
        } else {
            console.warn(`[Game ${gameId}] Invalid index ${i} encountered during 2D grid creation for shift.`);
        }
    }
    console.log(`[Game ${gameId}] submitShiftChoice: 2D grid created before shift:`, JSON.stringify(grid2D)); // Add log

    if (direction === 'vertical') { // Vertical choice = Shift UP 
        console.log(`[Game ${gameId}] Performing vertical compaction (shifting UP).`);
        // This shifts cards UPWARDS to fill gaps left by removed cards.
        for (let c = 0; c < COLS; c++) {
            let writeRow = 0; // Start writing from the top row
            for (let r = 0; r < ROWS; r++) {
                if (grid2D[r][c] !== null) { // If there's a card at [r][c]
                    if (r !== writeRow) { // If it's not already in the correct position
                        grid2D[writeRow][c] = grid2D[r][c]; // Move the card up
                        grid2D[r][c] = null; // Clear the original position
                    }
                     writeRow++; // Move to the next available slot in this column
                }
            }
        }
    } else { // direction === 'horizontal' // Horizontal choice = Shift LEFT
        console.log(`[Game ${gameId}] Performing horizontal compaction (shifting LEFT).`);
        // This shifts cards LEFTWARDS to fill gaps left by removed cards.
        for (let r = 0; r < ROWS; r++) {
            let writeCol = 0; // Start writing from the leftmost column
            for (let c = 0; c < COLS; c++) {
                if (grid2D[r][c] !== null) { // If there's a card at [r][c]
                    if (c !== writeCol) { // If it's not already in the correct position
                        grid2D[r][writeCol] = grid2D[r][c]; // Move the card left
                        grid2D[r][c] = null; // Clear the original position
                    }
                    writeCol++; // Move to the next available slot in this row
                }
            }
        }
    }
    console.log(`[Game ${gameId}] submitShiftChoice: 2D grid after shift (${direction}):`, JSON.stringify(grid2D)); // Add log

    // Convert the shifted 2D grid back to a 1D array
    // This seems correct.
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const index1D = (r * COLS) + c;
            newGrid[index1D] = grid2D[r][c]; 
        }
    }
    console.log(`[Game ${gameId}] submitShiftChoice: 1D grid after conversion:`, JSON.stringify(newGrid)); // Add log

    // Update the player's grid
    game.playerGrids[socket.id] = newGrid;
    const remainingCardCount = newGrid.filter(Boolean).length;
    console.log(`[Game ${gameId}] Grid for player ${player.name} compacted (${direction}) to ${remainingCardCount} cards.`);

    // Restore missing logic:
    // Reset player state flags
    console.log(`[Game ${gameId}] Resetting shift flags for player ${player.name}.`);
    player.awaitingShiftChoice = false;
    player.pendingAlignmentIndices = null;

    // NOW the turn ends. Check for last round completion *before* advancing index.
    const nextPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
    console.log(`[Game ${gameId}] submitShiftChoice: Checking last round condition. LastRoundTriggered: ${game.lastRoundTriggered}, NextPlayerID: ${game.players[nextPlayerIndex]?.id}, TriggererID: ${game.roundTriggererId}`); // Add log
    if (game.lastRoundTriggered && game.players[nextPlayerIndex].id === game.roundTriggererId) {
        console.log(`[Game ${gameId}] Last round completed by ${player.name} after shift choice. Triggering end sequence.`);
        triggerRoundEndSequence(gameId); // Call the sequence function
        return; // Stop further execution
    }

    // Advance turn
    console.log(`[Game ${gameId}] Turn ending for ${player.name} after shift choice.`);
    game.currentPlayerIndex = nextPlayerIndex;
    console.log(`[Game ${gameId}] Next player: ${game.players[game.currentPlayerIndex]?.name} (Index: ${game.currentPlayerIndex})`);


    // Send final game update after compaction and turn advance
    console.log(`[Game ${gameId}] submitShiftChoice: Emitting gameUpdate.`); // Add log
    io.to(gameId).emit('gameUpdate', {
      drawPile: game.drawPile.length,
      discardPile: game.discardPile,
      currentPlayer: game.players[game.currentPlayerIndex],
      players: game.players,
      playerGrids: createPlayerGridsData(game) 
    });

    // Check for end of round conditions (e.g., empty grid after compaction)
    console.log(`[Game ${gameId}] submitShiftChoice: Calling checkEndOfRound.`); // Add log
    checkEndOfRound(gameId);
  });

  // End round and calculate scores
  function endRound(gameId) {
    const game = games[gameId];
    if (!game) {
        console.error(`[Game ${gameId}] Attempted to end round, but game not found.`);
        return; // Safety check
    }

    console.log(`[Game ${gameId}] Ending Round ${game.rounds}. Calculating scores...`);

    // Reset last round flags before proceeding
    const triggererId = game.roundTriggererId; // Store triggerer ID
    game.lastRoundTriggered = false;
    game.roundTriggererId = null;
    
    // Calculate initial round scores and reset the scoreDoubled flag
    for (const player of game.players) {
      player.scoreDoubled = false; // Reset flag for all players
      const playerCards = game.playerGrids[player.id] || [];
      const roundScore = playerCards.reduce((sum, card) => {
        // Only sum if card exists (not null)
        return card ? sum + (card.number || 0) : sum; // Default number to 0 if missing
      }, 0);
      
      player.roundScore = roundScore;
      console.log(`[Game ${gameId}] Player ${player.name} initial round score: ${player.roundScore}.`);
      // Don't add to total score yet, wait until doubling check
    }

    // Find the player(s) with the HIGHEST round score
    let highestRoundScore = -Infinity; // Start with negative infinity
    game.players.forEach(player => {
        if (player.roundScore > highestRoundScore) {
            highestRoundScore = player.roundScore;
        }
    });
    console.log(`[Game ${gameId}] Highest round score calculated: ${highestRoundScore}.`);

    // Check if the triggerer (if it was a player) had the highest score (or tied for highest)
    let doubledPlayerId = null;
    if (triggererId) { // Check if the triggerer was a player
        const triggererPlayer = game.players.find(p => p.id === triggererId);
        
        // Check if the triggerer exists AND their score is the highest found AND the highest score is not negative
        if (triggererPlayer && triggererPlayer.roundScore === highestRoundScore && highestRoundScore >= 0) {
            console.log(`[Game ${gameId}] Player ${triggererPlayer.name} triggered round end and had the highest score (${triggererPlayer.roundScore}). Doubling score penalty.`);
            triggererPlayer.roundScore *= 2; 
            triggererPlayer.scoreDoubled = true;
            doubledPlayerId = triggererPlayer.id; // Keep track of who got doubled
            console.log(`[Game ${gameId}] Player ${triggererPlayer.name}'s score doubled to ${triggererPlayer.roundScore}.`);
        } else if (triggererPlayer) {
            console.log(`[Game ${gameId}] Player ${triggererPlayer.name} triggered round end but did not have the highest score (${triggererPlayer.roundScore} vs ${highestRoundScore}). No penalty.`);
        }
    } else {
        console.log(`[Game ${gameId}] Round ended by condition (e.g., empty draw pile), no specific player triggered. No score doubling check needed.`);
    }

    // Now, add the final round scores (potentially doubled) to total scores
    for (const player of game.players) {
        player.score += player.roundScore;
        console.log(`[Game ${gameId}] Player ${player.name} total score updated to ${player.score} (Round: ${player.roundScore}).`);
    }
    
    console.log(`[Game ${gameId}] Emitting 'roundEnd' event.`);
    io.to(gameId).emit('roundEnd', {
      players: game.players,
      doubledPlayerId: doubledPlayerId // Send ID of player whose score was doubled (or null)
    });
    
    // Check if any player has reached 100 points (game over)
    const gameOverPlayer = game.players.find(player => player.score >= 100);
    const gameOver = !!gameOverPlayer;
    
    if (gameOver) {
      console.log(`[Game ${gameId}] Game over condition met. Player ${gameOverPlayer.name} reached ${gameOverPlayer.score} points.`);
      endGame(gameId);
    } else {
      console.log(`[Game ${gameId}] Round ${game.rounds} finished. Scheduling start of next round.`);
      // Optionally check max rounds? game.rounds >= game.maxRounds?
      // if (game.rounds >= game.maxRounds) { endGame(gameId); } else { ... }
      setTimeout(() => startNewRound(gameId), 5000); // 5 second delay
    }
  }
  
  // NEW: Function to handle the sequence before ending the round
  function triggerRoundEndSequence(gameId) {
    const game = games[gameId];
    if (!game) {
        console.error(`[Game ${gameId}] Attempted to trigger end sequence, but game not found.`);
        return;
    }

    console.log(`[Game ${gameId}] Triggering round end sequence. Showing final grids for 4 seconds.`);

    // Emit the event to show final grids
    io.to(gameId).emit('showFinalGrids', {
        playerGrids: createPlayerGridsData(game),
        players: game.players,
        message: "Round Complete! Showing final grids before scoring..."
    });

    // Set timeout to call endRound after a delay
    setTimeout(() => {
        console.log(`[Game ${gameId}] Final grid display timer ended. Proceeding to endRound.`);
        endRound(gameId); // Proceed to scoring and next round/game over logic
    }, 4000); // 4 second delay
  }
  
  // Start a new round
  function startNewRound(gameId) {
    const game = games[gameId];
    if (!game) {
        console.error(`[Game ${gameId}] Attempted to start new round, but game not found.`);
        return;
    }
    
    console.log(`[Game ${gameId}] Preparing for new round...`);
    
    // Reset game state but keep player scores
    const allCards = [...game.drawPile, ...game.discardPile];
    console.log(`[Game ${gameId}] Collecting cards. Initial count (Draw + Discard): ${allCards.length}`);
    
    // Add cards from player grids
    for (const player of game.players) {
      if (game.playerGrids[player.id]) {
        const playerCards = game.playerGrids[player.id].filter(Boolean); // Filter out nulls
        allCards.push(...playerCards); 
        console.log(`[Game ${gameId}] Collected ${playerCards.length} cards from ${player.name}. Total cards: ${allCards.length}`);
      } else {
          console.warn(`[Game ${gameId}] No grid found for player ${player.name} during new round setup.`);
      }
      
      // Reset player round score
      player.roundScore = 0;
    }
    
    // Shuffle and redistribute
    console.log(`[Game ${gameId}] Shuffling ${allCards.length} cards.`);
    game.drawPile = shuffleArray(allCards);
    const discardStartCard = game.drawPile.pop();
    game.discardPile = [discardStartCard];
    game.rounds++;
    game.gamePhase = 'setup';
    game.playersReady = 0;
    game.lastRoundTriggered = false; // Reset last round flag
    game.roundTriggererId = null;   // Reset triggerer ID
    console.log(`[Game ${gameId}] Starting Round ${game.rounds}. Phase: ${game.gamePhase}. Draw: ${game.drawPile.length}, Discard: ${discardStartCard.number} ${discardStartCard.color}`);
    
    // Reset player ready status and other flags
    for (const player of game.players) {
      player.ready = false;
      player.mustFlipCard = false; 
      player.awaitingShiftChoice = false; 
      player.pendingAlignmentIndices = null; 
    }
    console.log(`[Game ${gameId}] Reset player flags (ready, mustFlip, awaitingShift).`);
    
    // Initialize player grids with face-down cards
    game.playerGrids = {};
    game.players.forEach(player => {
      const playerCards = [];
      for (let i = 0; i < 9; i++) {
        if (game.drawPile.length > 0) {
          const card = game.drawPile.pop();
          card.faceDown = true; // Mark card as face down
          playerCards.push(card);
        } else {
            console.warn(`[Game ${gameId}] Draw pile ran out while dealing new round cards to ${player.name}.`);
            break; // Stop dealing if draw pile is empty
        }
      }
      game.playerGrids[player.id] = playerCards;
      console.log(`[Game ${gameId}] Dealt ${playerCards.length} cards to ${player.name}.`);
    });
    
    // Send general game state to all players
    console.log(`[Game ${gameId}] Emitting 'newRound' to all players.`);
    io.to(gameId).emit('newRound', {
      round: game.rounds,
      gamePhase: game.gamePhase,
      drawPile: game.drawPile.length,
      discardPile: game.discardPile,
      currentPlayer: game.players[game.currentPlayerIndex], // Keep the same starting player index? Or rotate? Current keeps it.
      players: game.players,
      playerGrids: createPlayerGridsData(game)
    });
    
    // Send each player their specific grid
    game.players.forEach(player => {
      io.to(player.id).emit('playerGridUpdate', {
        playerGrid: game.playerGrids[player.id] || []
      });
    });
  }
  
  // End game and determine winner
  function endGame(gameId) {
    const game = games[gameId];
    if (!game) {
        console.error(`[Game ${gameId}] Attempted to end game, but game not found.`);
        return;
    }
    
    console.log(`[Game ${gameId}] Game over. Determining winner...`);
    
    // Sort players by score (ascending) to determine winner
    const sortedPlayers = [...game.players].sort((a, b) => a.score - b.score);
    
    console.log(`[Game ${gameId}] Winner determined: ${sortedPlayers[0]?.name || 'Unknown'} with score ${sortedPlayers[0]?.score}.`);
    console.log(`[Game ${gameId}] Final Scores:`, sortedPlayers.map(p => `${p.name}: ${p.score}`).join(', '));
    
    console.log(`[Game ${gameId}] Emitting 'gameOver' event.`);
    io.to(gameId).emit('gameOver', {
      players: sortedPlayers,
      winner: sortedPlayers[0]
    });
    
    // Clean up game data
    console.log(`[Game ${gameId}] Scheduling game data cleanup in 1 hour.`);
    setTimeout(() => {
      console.log(`[Game ${gameId}] Deleting game data.`);
      delete games[gameId];
    }, 3600000); // Remove game data after 1 hour
  }
  
  // Disconnect handling
  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    
    // Find and handle player leaving games
    for (const gameId in games) {
      const game = games[gameId];
      const playerIndex = game.players.findIndex(p => p.id === socket.id);
      
      if (playerIndex !== -1) {
        const leavingPlayerName = game.players[playerIndex].name;
        console.log(`[Game ${gameId}] Player ${leavingPlayerName} (ID: ${socket.id}) disconnected.`);
        game.players.splice(playerIndex, 1);
        
        if (game.players.length === 0) {
          // Delete game if no players left
          console.log(`[Game ${gameId}] Last player disconnected. Deleting game.`);
          delete games[gameId];
        } else if (game.gameStarted) {
          // Handle disconnection during active game
          console.log(`[Game ${gameId}] Player ${leavingPlayerName} left during active game. Notifying remaining players.`);
          io.to(gameId).emit('playerLeft', socket.id);
          
          // Adjust current player index if necessary
          let currentPlayerChanged = false;
          if (game.currentPlayerIndex === playerIndex) {
             // If the leaving player was the current player, advance turn
             game.currentPlayerIndex = game.currentPlayerIndex % game.players.length; // This handles wrap-around
             currentPlayerChanged = true;
             console.log(`[Game ${gameId}] Leaving player was current player. New current player: ${game.players[game.currentPlayerIndex]?.name}`);
          } else if (game.currentPlayerIndex > playerIndex) {
             // If the current player was after the leaving player, decrement the index
             game.currentPlayerIndex--;
             currentPlayerChanged = true; // Flag that index might have changed logically even if value same
             console.log(`[Game ${gameId}] Current player index shifted due to player leaving. New index: ${game.currentPlayerIndex} (${game.players[game.currentPlayerIndex]?.name})`);
          }
          
          // Send update only if necessary (player left or turn changed)
          if (currentPlayerChanged || game.players.length > 0) { // Update if turn changed or players remain
              io.to(gameId).emit('gameUpdate', {
                drawPile: game.drawPile.length,
                discardPile: game.discardPile,
                currentPlayer: game.players[game.currentPlayerIndex], // Send potentially updated player
                players: game.players, // Send updated player list
                playerGrids: createPlayerGridsData(game) // Send grids (might be needed)
              });
              // Check if round end condition is met due to disconnection (e.g., only 1 player left?)
              // Add specific logic here if needed. For now, checkEndOfRound covers grid/pile based ends.
              checkEndOfRound(gameId);
          }

        } else {
          // Game not started, just update lobby
          console.log(`[Game ${gameId}] Player ${leavingPlayerName} left before game start. Updating lobby.`);
          io.to(gameId).emit('updatePlayers', game.players);
          // If the host (player 0) leaves before start, maybe designate new host?
          if (playerIndex === 0 && game.players.length >= 2) {
              console.log(`[Game ${gameId}] Host disconnected, enabling start for new host: ${game.players[0].name}.`);
              io.to(game.players[0].id).emit('readyToStart', true);
          } else if (game.players.length < 2) {
               // If player count drops below 2, disable start for host
               if(game.players.length === 1) {
                   console.log(`[Game ${gameId}] Player count dropped below 2. Disabling start for host: ${game.players[0].name}.`);
                   io.to(game.players[0].id).emit('readyToStart', false);
               }
          }
        }
        // Exit loop once the game containing the disconnected player is found and handled
        break; 
      }
    }
  });

  // Check if round should end
  function checkEndOfRound(gameId) {
    const game = games[gameId];
    if (!game) return false; // Safety check
    
    // If last round already triggered, don't check again
    if (game.lastRoundTriggered) {
        // console.log(`[Game ${gameId}] checkEndOfRound: Last round already triggered. Skipping checks.`); // Uncomment if needed
        return false; 
    }

    console.log(`[Game ${gameId}] Checking end-of-round conditions.`);
    
    let triggerConditionMet = false;
    let triggererId = null;
    let triggerReason = '';

    // Check if any player has no cards or all cards flipped
    for (const player of game.players) {
      const playerGrid = game.playerGrids[player.id] || [];
      const activeCards = playerGrid.filter(Boolean); // Filter out null slots

      // Player has no cards left (all slots are null or array is empty)
      if (activeCards.length === 0) {
        triggerConditionMet = true;
        triggererId = player.id;
        triggerReason = `Player ${player.name} has no cards left.`;
        break; // Found a trigger, no need to check others for this type
      }
      
      // All remaining cards are face up 
      // Check only if there are active cards to avoid triggering on empty grid again
      if (activeCards.length > 0 && activeCards.every(card => !card.faceDown)) {
        triggerConditionMet = true;
        triggererId = player.id;
        triggerReason = `Player ${player.name} has all cards face up.`;
        break; // Found a trigger
      }
    }
    
    // Also check if draw pile is empty, but only if no player condition was met first
    if (!triggerConditionMet && game.drawPile.length === 0) {
      triggerConditionMet = true;
      triggererId = null; // No specific player triggered by empty draw pile
      triggerReason = `Draw pile empty.`;
    }
    
    // If a condition was met, trigger the last round sequence
    if (triggerConditionMet) {
        console.log(`[Game ${gameId}] Last round triggered! Reason: ${triggerReason}. Triggerer ID: ${triggererId || 'None'}.`);
        game.lastRoundTriggered = true;
        game.roundTriggererId = triggererId;
        io.to(gameId).emit('lastRoundTriggered', { triggererId: triggererId });
        return false; // Indicate that the round end *sequence* was triggered, but round doesn't end *immediately*
    } else {
        // console.log(`[Game ${gameId}] No end-of-round condition met.`); // Can be noisy
        return false; // No end condition met yet
    }
  }
});

// Add a helper function to create player grids data (Should be outside io.on('connection', ...))
function createPlayerGridsData(game) {
  const playerGridsData = {};
  if (!game || !game.playerGrids) return playerGridsData; // Safety check

  for (const playerId in game.playerGrids) {
    const grid = game.playerGrids[playerId];
    if (grid && Array.isArray(grid)) { // Check if grid exists and is an array
        // Map the cards directly. The grid array might contain nulls now.
        playerGridsData[playerId] = grid.map(card => {
          // If card is null, return null
          if (!card) return null; 
          // Otherwise, return card data, ensuring properties exist
          return {
            color: card.color || 'unknown', // Default if missing
            number: typeof card.number === 'number' ? card.number : -99, // Default if missing/wrong type
            faceDown: card.faceDown === true // Ensure boolean
          };
        });
    } else {
        console.warn(`[Game ${game.id}] Missing or invalid grid for player ${playerId} in createPlayerGridsData.`);
        playerGridsData[playerId] = Array(9).fill(null); // Send empty/null grid of expected size
    }
  }
  
  return playerGridsData;
}

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});