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
  return game;
}

// Send updates about all player grids to all clients
function sendAllPlayerGrids(gameId) {
  const game = games[gameId];
  
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
      game = createNewGame(gameId);
    }
    
    if (game.gameStarted) {
      socket.emit('error', 'Game already started');
      return;
    }
    
    if (game.players.length >= 6) {
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
    
    // Determine max rounds based on player count
    if (game.players.length >= 5) {
      game.maxRounds = 3;
    } else if (game.players.length >= 3) {
      game.maxRounds = 2;
    } else {
      game.maxRounds = 1;
    }
    
    socket.emit('joinedGame', { gameId, player });
    io.to(gameId).emit('updatePlayers', game.players);
    
    // If 2 or more players have joined, allow starting the game
    if (game.players.length >= 2) {
      io.to(game.players[0].id).emit('readyToStart', true);
    }
  });
  
  // Start game
  socket.on('startGame', (gameId) => {
    const game = games[gameId];
    
    if (!game || game.gameStarted) return;
    if (game.players.length < 2) return;
    
    game.gameStarted = true;
    game.gamePhase = 'setup';
    game.rounds++;
    
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
    });
    
    // Move first card to discard pile
    game.discardPile.push(game.drawPile.pop());
    
    // Send initial game state to all players
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
    
    if (!game || !game.gameStarted) return; // General check

    const currentPlayer = game.players.find(p => p.id === socket.id);
    if (!currentPlayer) return; // Player not found?
    
    const playerGrid = game.playerGrids[socket.id];
    if (!playerGrid) return;
    
    // --- Setup Phase Logic ---
    if (game.gamePhase === 'setup') {
      // Check if card exists and is face down
      if (cardIndex >= 0 && cardIndex < playerGrid.length && playerGrid[cardIndex].faceDown) {
        playerGrid[cardIndex].faceDown = false;
        
        // Count how many cards player has flipped
        const flippedCount = playerGrid.filter(card => !card.faceDown).length;
        
        // If player has flipped 2 cards, mark them as ready
        if (flippedCount === 2) {
          // Check if this player wasn't already counted as ready
          const playerAlreadyReady = game.players.find(p => p.id === socket.id && p.ready);
          if (!playerAlreadyReady) {
            game.playersReady++;
            currentPlayer.ready = true; // Mark this player as ready
          }
          
          // Check if all players are ready to start playing phase
          if (game.playersReady === game.players.length) {
            game.gamePhase = 'play';
            io.to(gameId).emit('playPhaseStarted', {
              currentPlayer: game.players[game.currentPlayerIndex],
              players: game.players,
              playerGrids: createPlayerGridsData(game)
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
         socket.emit('error', 'Invalid selection or card already face up.');
      }
      return; // End processing for setup phase
    }

    // --- Play Phase Logic ---
    if (game.gamePhase === 'play') {
       // Check if it's the current player's turn
       if (socket.id !== game.players[game.currentPlayerIndex].id) {
         socket.emit('error', 'Not your turn to flip');
         return;
       }

       // Ensure player is not in a preview state (drawing action)
       if (game.drawnCardPreview[socket.id]) {
           socket.emit('error', 'Invalid action. Complete your draw action first.');
           return;
       }

       // Validate card selection
       if (typeof cardIndex !== 'number' || cardIndex < 0 || cardIndex >= playerGrid.length || !playerGrid[cardIndex].faceDown) {
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
       console.log(`Player ${currentPlayer.name} flipped card at index ${cardIndex} (Mandatory: ${isMandatoryFlip})`);

       // Reset the flag if it was a mandatory flip
       if (isMandatoryFlip) {
           currentPlayer.mustFlipCard = false;
       }

       // Check for alignments AFTER flipping the card
       const alignmentFound = checkForAlignments(gameId, socket.id);

       // Check if this action completes the final round
       const nextPlayerIndexIfTurnEnds = (game.currentPlayerIndex + 1) % game.players.length;
       if (game.lastRoundTriggered && game.players[nextPlayerIndexIfTurnEnds].id === game.roundTriggererId) {
           console.log(`Last round completed by ${currentPlayer.name} flipping card. Triggering end sequence.`);
           triggerRoundEndSequence(gameId); // Call the sequence function
           return; // Stop further execution in this handler
       }

       // If an alignment was found, the turn does NOT end here. 
       // It ends after the player chooses the shift direction.
       if (!alignmentFound) {
           // Advance to the next player ONLY if no alignment choice is pending
           game.currentPlayerIndex = nextPlayerIndexIfTurnEnds;

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
           // Alignment found, player needs to choose shift. Send updated grid data only.
           io.to(gameId).emit('gameUpdatePartial', { 
               playerGrids: createPlayerGridsData(game) // Show the grid before compaction
           });
       }
    } else {
        socket.emit('error', 'Cannot flip card in current game phase.');
    }
  });
  
  // Player requests to draw a card
  socket.on('requestDraw', (gameId) => {
    const game = games[gameId];
    if (!game || !game.gameStarted || game.gamePhase !== 'play') {
      console.log('Invalid state for drawing');
      return;
    }

    const currentPlayer = game.players[game.currentPlayerIndex];
    if (socket.id !== currentPlayer.id) {
      socket.emit('error', 'Not your turn');
      return;
    }

    // Check if player is already previewing a card or must flip
    if (game.drawnCardPreview[socket.id] || currentPlayer.mustFlipCard) {
        socket.emit('error', 'Invalid action. Complete your current action first.');
        return;
    }

    if (game.drawPile.length === 0) {
      socket.emit('error', 'Draw pile is empty');
      // Potentially end round here if needed by rules
      return;
    }

    const drawnCard = game.drawPile.pop();
    drawnCard.faceDown = false; // Ensure it's face up for preview
    game.drawnCardPreview[socket.id] = drawnCard;

    console.log(`Player ${currentPlayer.name} drew ${drawnCard.number} ${drawnCard.color} for preview.`);

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
    if (!game || !game.gameStarted || game.gamePhase !== 'play') return;

    const currentPlayer = game.players[game.currentPlayerIndex];
    if (socket.id !== currentPlayer.id) {
      socket.emit('error', 'Not your turn');
      return;
    }

    // Check if player actually has a card being previewed
    const cardToPlace = game.drawnCardPreview[socket.id];
    if (!cardToPlace) {
        socket.emit('error', 'No card is being previewed.');
        return;
    }

    // Clear the preview card state FIRST
    delete game.drawnCardPreview[socket.id];

    // Action 1: Discard the drawn card and must flip
    if (action === 'discardAndFlip') {
      game.discardPile.push(cardToPlace);
      console.log(`Player ${currentPlayer.name} discarded previewed card. Must flip.`);
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
          socket.emit('error', 'Grid index required for exchange.');
          // Put the card back? No, it was already removed from preview. Error is enough.
          return;
      }

      const playerGrid = game.playerGrids[socket.id];
      if (!playerGrid || typeof gridIndex !== 'number' || gridIndex < 0 || gridIndex >= playerGrid.length) {
          socket.emit('error', 'Invalid grid position selected.');
          return;
      }
      
      const cardInGrid = playerGrid[gridIndex];
      console.log(`Player ${currentPlayer.name} exchanging previewed card with grid index ${gridIndex}`);

      // Place the drawn card into the player's grid
      playerGrid[gridIndex] = { ...cardToPlace, faceDown: false }; // It was already faceup
      // Put the card that was in the grid onto the discard pile
      game.discardPile.push(cardInGrid);

      // Check for alignments BEFORE ending the turn
      const alignmentFound = checkForAlignments(gameId, socket.id);
      
      // Check if this action completes the final round
      const nextPlayerIndexIfTurnEnds = (game.currentPlayerIndex + 1) % game.players.length;
      if (game.lastRoundTriggered && game.players[nextPlayerIndexIfTurnEnds].id === game.roundTriggererId) {
          console.log(`Last round completed by ${currentPlayer.name} exchanging drawn card. Triggering end sequence.`);
          triggerRoundEndSequence(gameId); // Call the sequence function
          return; // Stop further execution in this handler
      }
      
      // If an alignment was found, the turn does NOT end here. 
      // It ends after the player chooses the shift direction.
      if (!alignmentFound) {
           // Advance to the next player ONLY if no alignment choice is pending
           game.currentPlayerIndex = nextPlayerIndexIfTurnEnds;

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
           // Alignment found, player needs to choose shift. Send updated grid data only.
           io.to(gameId).emit('gameUpdatePartial', { 
               playerGrids: createPlayerGridsData(game) // Show the grid before compaction
           });
      }
      return;
    }

    // Invalid action
    socket.emit('error', 'Invalid action specified for placing drawn card.');
  });
  
  // Place a card (Only for Discard -> Grid exchange)
  socket.on('placeCard', (gameId, { source, gridIndex }) => {
    const game = games[gameId];
    
    if (!game || !game.gameStarted || game.gamePhase !== 'play') {
      console.log('Game not started or not in play phase');
      return;
    }
    
    const currentPlayer = game.players[game.currentPlayerIndex];
    if (socket.id !== currentPlayer.id) {
      socket.emit('error', 'Not your turn');
      return;
    }

    // Ensure player is not in a mustFlip or preview state
     if (currentPlayer.mustFlipCard || game.drawnCardPreview[socket.id]) {
        socket.emit('error', 'Invalid action. Complete your current action first.');
        return;
    }
    
    // This handler is ONLY for taking from discard now
    if (source !== 'discard') {
        socket.emit('error', 'Invalid source for placeCard. Use requestDraw/placeDrawnCard for draw pile actions.');
        return;
    }

    if (game.discardPile.length === 0) {
      socket.emit('error', 'Discard pile is empty');
      return;
    }
    
    // Taking from discard requires selecting a grid card
    if (typeof gridIndex === 'undefined' || gridIndex === null) {
        socket.emit('error', 'Must select a grid card to exchange with discard pile card');
        return;
    }
    
    const cardToPlace = game.discardPile.pop();
    
    // --- Exchange Logic ---
    const playerGrid = game.playerGrids[socket.id];
    if (!playerGrid || typeof gridIndex !== 'number' || gridIndex < 0 || gridIndex >= playerGrid.length) {
        socket.emit('error', 'Invalid grid position selected');
        game.discardPile.push(cardToPlace); // Return card taken from discard
        return;
    }

    const cardInGrid = playerGrid[gridIndex];
    
    console.log(`Player ${currentPlayer.name} exchanging discard card with grid index ${gridIndex}`);

    // Place the discard card into the player's grid
    playerGrid[gridIndex] = { ...cardToPlace, faceDown: false };
    // Put the card that was in the grid onto the discard pile
    game.discardPile.push(cardInGrid);

    // Check for alignments BEFORE ending the turn
    const alignmentFound = checkForAlignments(gameId, socket.id);
    
    // Check if this action completes the final round
    const nextPlayerIndexIfTurnEnds = (game.currentPlayerIndex + 1) % game.players.length;
    if (game.lastRoundTriggered && game.players[nextPlayerIndexIfTurnEnds].id === game.roundTriggererId) {
        console.log(`Last round completed by ${currentPlayer.name} exchanging discard card. Triggering end sequence.`);
        triggerRoundEndSequence(gameId); // Call the sequence function
        return; // Stop further execution in this handler
    }
    
    // If an alignment was found, the turn does NOT end here. 
    // It ends after the player chooses the shift direction.
    if (!alignmentFound) {
       // Advance to the next player ONLY if no alignment choice is pending
       game.currentPlayerIndex = nextPlayerIndexIfTurnEnds;

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

        if (card1 && card2 && card3 && 
            !card1.faceDown && !card2.faceDown && !card3.faceDown &&
            card1.color === card2.color && card1.color === card3.color) 
        {
            console.log(`Alignment DETECTED (${type}) for player ${playerId} at indices: ${i1}, ${i2}, ${i3}`);
            
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
        console.log(`Player ${playerId} discarded aligned cards:`, alignedCards.map(c => `${c.number} ${c.color}`));
    }
    // --- End NEW ---

    if (indicesToRemove.size === 0) {
        return false; // No alignments found
    }

    // If diagonal alignment exists, always prompt for choice
    if (foundDiagAlignment) {
        console.log(`Diagonal alignment found for player ${playerId}. Prompting for shift choice. Indices:`, Array.from(indicesToRemove));
        player.awaitingShiftChoice = true;
        player.pendingAlignmentIndices = Array.from(indicesToRemove); 
        io.to(playerId).emit('promptShiftChoice', {
            message: 'Diagonal alignment found! Choose shift direction.',
            indices: player.pendingAlignmentIndices
        });
        return true; // Pause the turn
    }
     
    // If only Row or Column alignments (no diagonal), compact directly
    console.log(`Non-diagonal alignment found for player ${playerId}. Compacting automatically (vertical shift). Indices:`, Array.from(indicesToRemove));

    // --- Start: Adapted Compaction Logic ---
    const ROWS = 3;
    const COLS = 3;
    let newGrid = Array(ROWS * COLS).fill(null); 

    // Create a 2D representation
    let grid2D = Array(ROWS).fill(null).map(() => Array(COLS).fill(null));
    for(let i = 0; i < playerGrid.length; i++) {
        const row = Math.floor(i / COLS);
        const col = i % COLS;
        if(row < ROWS && col < COLS) { 
             grid2D[row][col] = indicesToRemove.has(i) ? null : playerGrid[i]; 
        }
    }

    // Perform Vertical Shift (Shift UP)
    for (let c = 0; c < COLS; c++) {
        let writeRow = 0;
        for (let r = 0; r < ROWS; r++) {
            if (grid2D[r][c] !== null) { 
                if (r !== writeRow) { 
                    grid2D[writeRow][c] = grid2D[r][c];
                    grid2D[r][c] = null; 
                }
                 writeRow++; 
            }
        }
    }
    
    // Convert back to 1D
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const index1D = (r * COLS) + c;
            newGrid[index1D] = grid2D[r][c]; 
        }
    }
    // --- End: Adapted Compaction Logic ---

    game.playerGrids[playerId] = newGrid;
    // Use filter(Boolean) to count only actual cards, not nulls
    const remainingCardCount = newGrid.filter(Boolean).length; 
    console.log(`Grid for player ${playerId} automatically compacted (vertical) to ${remainingCardCount} cards.`);

    // Check end of round conditions after direct compaction
    checkEndOfRound(gameId); 

    // Return false because the action is complete, turn should proceed
    return false; 
  }
  
  // End round and calculate scores
  function endRound(gameId) {
    const game = games[gameId];
    if (!game) return; // Safety check

    console.log(`Ending round ${game.rounds} for game ${gameId}`);

    // Reset last round flags before proceeding
    game.lastRoundTriggered = false;
    game.roundTriggererId = null;
    
    // Calculate round scores
    for (const player of game.players) {
      // Calculate score from player's remaining cards
      const playerCards = game.playerGrids[player.id] || [];
      // Filter out null cards before calculating score
      const roundScore = playerCards.reduce((sum, card) => {
        // Only add score if card is not null
        return card ? sum + card.number : sum; 
      }, 0);
      
      // Add to player's total score
      player.roundScore = roundScore;
      player.score += roundScore;
    }
    
    io.to(gameId).emit('roundEnd', {
      players: game.players
    });
    
    // Check if any player has reached 100 points (game over)
    const gameOver = game.players.some(player => player.score >= 100);
    
    if (gameOver) {
      endGame(gameId);
    } else {
      setTimeout(() => startNewRound(gameId), 5000);
    }
  }
  
  // NEW: Function to handle the sequence before ending the round
  function triggerRoundEndSequence(gameId) {
    const game = games[gameId];
    if (!game) return;

    console.log(`Triggering round end sequence for game ${gameId}. Showing final grids.`);

    // Emit the event to show final grids
    io.to(gameId).emit('showFinalGrids', {
        playerGrids: createPlayerGridsData(game),
        players: game.players,
        message: "Round Complete! Showing final grids before scoring..."
    });

    // Set timeout to call endRound after a delay
    setTimeout(() => {
        endRound(gameId); // Proceed to scoring and next round/game over logic
    }, 4000); // 4 second delay
  }
  
  // Start a new round
  function startNewRound(gameId) {
    const game = games[gameId];
    
    // Reset game state but keep player scores
    const allCards = [...game.drawPile, ...game.discardPile];
    
    // Add cards from player grids
    for (const player of game.players) {
      if (game.playerGrids[player.id]) {
        // Filter out null values before spreading
        allCards.push(...game.playerGrids[player.id].filter(Boolean)); 
      }
      
      // Reset player round score
      player.roundScore = 0;
    }
    
    // Shuffle and redistribute
    game.drawPile = shuffleArray(allCards);
    game.discardPile = [game.drawPile.pop()];
    game.rounds++;
    game.gamePhase = 'setup';
    game.playersReady = 0;
    game.lastRoundTriggered = false; // Reset last round flag
    game.roundTriggererId = null;   // Reset triggerer ID
    
    // Reset player ready status
    for (const player of game.players) {
      player.ready = false;
      player.mustFlipCard = false; // Also reset mustFlipCard
      player.awaitingShiftChoice = false; // Reset shift choice flag
      player.pendingAlignmentIndices = null; // Reset pending indices
    }
    
    // Initialize player grids with face-down cards
    game.playerGrids = {};
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
    });
    
    // Send general game state to all players
    io.to(gameId).emit('newRound', {
      round: game.rounds,
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
  }
  
  // End game and determine winner
  function endGame(gameId) {
    const game = games[gameId];
    
    // Sort players by score (ascending) to determine winner
    const sortedPlayers = [...game.players].sort((a, b) => a.score - b.score);
    
    io.to(gameId).emit('gameOver', {
      players: sortedPlayers,
      winner: sortedPlayers[0]
    });
    
    // Clean up game data
    setTimeout(() => {
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
        game.players.splice(playerIndex, 1);
        
        if (game.players.length === 0) {
          // Delete game if no players left
          delete games[gameId];
        } else if (game.gameStarted) {
          // Handle disconnection during active game
          io.to(gameId).emit('playerLeft', socket.id);
          
          // If it was this player's turn, move to next player
          if (game.currentPlayerIndex === playerIndex) {
            game.currentPlayerIndex = game.currentPlayerIndex % game.players.length;
            io.to(gameId).emit('gameUpdate', {
              drawPile: game.drawPile.length,
              discardPile: game.discardPile,
              currentPlayer: game.players[game.currentPlayerIndex],
              players: game.players
            });
          }
        } else {
          io.to(gameId).emit('updatePlayers', game.players);
        }
      }
    }
  });

  // Check if round should end
  function checkEndOfRound(gameId) {
    const game = games[gameId];
    
    // If last round already triggered, don't check again
    if (game.lastRoundTriggered) return false; 

    // Check if any player has no cards or all cards flipped
    for (const player of game.players) {
      const playerGrid = game.playerGrids[player.id] || [];
      
      // Player has no cards
      if (playerGrid.length === 0) {
        console.log(`Player ${player.name} has no cards left. Triggering last round.`);
        game.lastRoundTriggered = true;
        game.roundTriggererId = player.id; 
        io.to(gameId).emit('lastRoundTriggered', { triggererId: player.id });
        return false; // Don't end immediately, just trigger
      }
      
      // All cards are face up (treat null slots as face up)
      const allFaceUp = playerGrid.every(card => card === null || !card.faceDown);
      if (allFaceUp) {
        console.log(`Player ${player.name} has all cards face up or empty. Triggering last round.`);
        game.lastRoundTriggered = true;
        game.roundTriggererId = player.id;
        io.to(gameId).emit('lastRoundTriggered', { triggererId: player.id });
        return false; // Don't end immediately, just trigger
      }
    }
    
    // Also check if draw pile is empty
    if (game.drawPile.length === 0) {
      console.log(`Draw pile empty. Triggering last round.`);
      game.lastRoundTriggered = true;
      game.roundTriggererId = null; // No specific player triggered by empty draw pile
      io.to(gameId).emit('lastRoundTriggered', { triggererId: null });
      return false; // Don't end immediately, just trigger
    }
    
    return false; // No end condition met yet
  }

  // Request all player grids update 
  socket.on('requestAllPlayerGrids', (gameId) => {
    const game = games[gameId];
    if (!game) return;
    
    // Send all player grids
    sendAllPlayerGrids(gameId);
  });

  // Handle player's choice for shifting after alignment
  socket.on('submitShiftChoice', (gameId, direction) => {
    const game = games[gameId];
    if (!game || !game.gameStarted) return; 

    const player = game.players.find(p => p.id === socket.id);

    // Validate: Is it this player's turn? Are they awaiting choice? Is direction valid?
    if (!player || socket.id !== game.players[game.currentPlayerIndex].id || !player.awaitingShiftChoice || !['horizontal', 'vertical'].includes(direction)) {
        socket.emit('error', 'Invalid state or choice for shifting.');
        // Do NOT reset flags here, let them try again if it was just a bad direction
        return;
    }

    const playerGrid = game.playerGrids[socket.id];
    const indicesToRemove = new Set(player.pendingAlignmentIndices || []);

    if (indicesToRemove.size === 0 || !playerGrid) {
        console.error('Error: Shift choice submitted but no pending indices or grid found.');
        // Reset state and attempt to proceed turn normally
        player.awaitingShiftChoice = false;
        player.pendingAlignmentIndices = null;
        // Consider advancing turn here if robust error recovery is needed
        return; 
    }

    console.log(`Player ${player.name} chose ${direction} shift for indices:`, Array.from(indicesToRemove));

    // --- Compaction Logic --- 
    // Define grid dimensions first
    const ROWS = 3;
    const COLS = 3;
    // Initialize the target 1D array
    let newGrid = Array(ROWS * COLS).fill(null); // Create a 1D array of size 9, initialized to null

    // Create a 2D representation for easier shifting logic
    let grid2D = Array(ROWS).fill(null).map(() => Array(COLS).fill(null));
    for(let i = 0; i < playerGrid.length; i++) {
        const row = Math.floor(i / COLS);
        const col = i % COLS;
        if(row < ROWS && col < COLS) { // Bounds check
             grid2D[row][col] = indicesToRemove.has(i) ? null : playerGrid[i]; 
        }
    }

    // ** Revert Logic Swap Here **
    if (direction === 'vertical') { // Vertical choice = Shift UP (Vertical movement)
        // Shift cards DOWN within each column to fill gaps (Moves vertically)
        for (let c = 0; c < COLS; c++) {
            let writeRow = 0;
            for (let r = 0; r < ROWS; r++) {
                if (grid2D[r][c] !== null) { // If there's a card here
                    if (r !== writeRow) { // If it needs shifting
                        grid2D[writeRow][c] = grid2D[r][c];
                        grid2D[r][c] = null; // Clear original position
                    }
                     writeRow++; // Move to next write position in the column
                }
            }
        }
    } else { // direction === 'horizontal' // Horizontal choice = Shift LEFT (Horizontal movement)
        // Shift cards LEFT within each row to fill gaps (Moves horizontally)
        for (let r = 0; r < ROWS; r++) {
            let writeCol = 0;
            for (let c = 0; c < COLS; c++) {
                if (grid2D[r][c] !== null) { // If there's a card here
                    if (c !== writeCol) { // If it needs shifting
                        grid2D[r][writeCol] = grid2D[r][c];
                        grid2D[r][c] = null; // Clear original position
                    }
                    writeCol++; // Move to next write position in the row
                }
            }
        }
    }

    // Convert the shifted 2D grid back to a 1D array, preserving nulls
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            // Calculate the 1D index: (row * columns) + column
            const index1D = (r * COLS) + c;
            // Place the card (or null) from the shifted 2D grid into the correct 1D position
            newGrid[index1D] = grid2D[r][c]; 
        }
    }
    // --- End Compaction Logic ---

    // Update the player's grid
    game.playerGrids[socket.id] = newGrid;
    console.log(`Grid for player ${player.name} compacted (${direction}) to ${newGrid.length} cards.`);

    // Restore missing logic:
    // Reset player state flags
    player.awaitingShiftChoice = false;
    player.pendingAlignmentIndices = null;

    // NOW the turn ends. Check for last round completion *before* advancing index.
    const nextPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
    if (game.lastRoundTriggered && game.players[nextPlayerIndex].id === game.roundTriggererId) {
        console.log(`Last round completed by ${player.name} after shift choice. Triggering end sequence.`);
        triggerRoundEndSequence(gameId); // Call the sequence function
        return; // Stop further execution
    }

    // Advance turn
    game.currentPlayerIndex = nextPlayerIndex;

    // Send final game update after compaction and turn advance
    io.to(gameId).emit('gameUpdate', {
      drawPile: game.drawPile.length,
      discardPile: game.discardPile,
      currentPlayer: game.players[game.currentPlayerIndex],
      players: game.players,
      playerGrids: createPlayerGridsData(game) 
    });

    // Check for end of round conditions (e.g., empty grid after compaction)
    checkEndOfRound(gameId);
  });
});

// Add a helper function to create player grids data (Should be outside io.on('connection', ...))
function createPlayerGridsData(game) {
  const playerGridsData = {};
  
  for (const playerId in game.playerGrids) {
    // Ensure we have the grid data for the player
    const grid = game.playerGrids[playerId];
    if (grid) {
        // Map the cards directly. The grid array might contain nulls now.
        playerGridsData[playerId] = grid.map(card => {
          // If card is null, return null
          if (!card) return null; 
          // Otherwise, return card data
          return {
            color: card.color,
            number: card.number,
            faceDown: card.faceDown
          };
        });
    } else {
        playerGridsData[playerId] = []; // Send empty array if grid somehow missing
    }
  }
  
  return playerGridsData;
}

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});