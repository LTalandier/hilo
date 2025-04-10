// Connect to the server
const socket = io();

// DOM Elements (Declare variables here)
let lobby, gameBoard, roundEnd, gameOver, playerNameInput, gameIdInput, joinGameBtn, 
    playersList, playersUl, startGameBtn, currentRoundSpan, currentPlayerSpan, 
    drawPileCountSpan, discardPileCard, drawPileDiv, gridContainer, playerMessage, 
    playersStatusList, roundScoresDiv, countdownSpan, finalScoresDiv, 
    winnerAnnouncementDiv, newGameBtn, drawnCardPreviewDiv, shiftChoiceControls, 
    shiftHorizontalBtn, shiftVerticalBtn;

// Game state
let gameId = null;
let playerId = null;
let playerName = null;
let isMyTurn = false;
let selectedCard = null;
let playerGrid = []; // The player's personal grid of 9 cards
let gamePhase = 'setup'; // Current game phase: 'setup', 'play'
let flippedCount = 0; // Track how many cards the player has flipped
let currentAction = null; // Player's current action state: null, 'drawnPreview', 'mustFlip', 'discardSelected', 'flipOnlySelected', 'waitingForPreview', 'awaitingShiftChoice'
let players = []; // Store the current list of players globally
let currentPendingAlignmentIndices = []; // Store indices for shift preview

// Store other players' grids for display
const playerGrids = {};

// Card colors mapping
const cardColorMap = {
    0: 'yellow',
    1: 'red',
    2: 'orange',
    3: 'yellow',
    4: 'green',
    5: 'blue',
    6: 'purple'
};

// --- Wait for DOM to Load --- 
document.addEventListener('DOMContentLoaded', () => {
    // Assign DOM Elements now that they exist
    lobby = document.getElementById('lobby');
    gameBoard = document.getElementById('game-board');
    roundEnd = document.getElementById('round-end');
    gameOver = document.getElementById('game-over');

    playerNameInput = document.getElementById('player-name');
    gameIdInput = document.getElementById('game-id');
    joinGameBtn = document.getElementById('join-game-btn');
    playersList = document.getElementById('players-list');
    playersUl = document.getElementById('players');
    startGameBtn = document.getElementById('start-game-btn');

    currentRoundSpan = document.getElementById('current-round');
    currentPlayerSpan = document.getElementById('current-player');
    drawPileCountSpan = document.getElementById('draw-pile-count');
    discardPileCard = document.getElementById('discard-pile-card');
    drawPileDiv = document.getElementById('draw-pile');
    gridContainer = document.getElementById('grid-container');
    playerMessage = document.getElementById('player-message');
    playersStatusList = document.getElementById('players-status-list');

    roundScoresDiv = document.getElementById('round-scores');
    countdownSpan = document.getElementById('countdown');
    finalScoresDiv = document.getElementById('final-scores');
    winnerAnnouncementDiv = document.getElementById('winner-announcement');
    newGameBtn = document.getElementById('new-game-btn');
    drawnCardPreviewDiv = document.getElementById('drawn-card-preview');
    
    // Get shift choice elements
    shiftChoiceControls = document.getElementById('shift-choice-controls');
    shiftHorizontalBtn = document.getElementById('shift-horizontal-btn');
    shiftVerticalBtn = document.getElementById('shift-vertical-btn');

    // --- Attach Event Listeners --- 
    joinGameBtn.addEventListener('click', () => {
        playerName = playerNameInput.value.trim() || 'Player';
        gameId = gameIdInput.value.trim() || 'game_' + Math.random().toString(36).substring(2, 8);
        
        gameIdInput.value = gameId;
        
        socket.emit('joinGame', gameId, playerName);
    });

    startGameBtn.addEventListener('click', () => {
        socket.emit('startGame', gameId);
    });

    drawPileDiv.addEventListener('click', () => {
        if (!isMyTurn || currentAction !== null) {
            playerMessage.textContent = !isMyTurn ? 'Not your turn!' : 'Complete your current action first.';
            return;
        }
        
        // Check if draw pile display shows it's empty (client-side check)
        if (drawPileCountSpan && parseInt(drawPileCountSpan.textContent) <= 0) {
             playerMessage.textContent = 'Draw pile is empty!';
             return;
        }

        playerMessage.textContent = 'Drawing card...';
        // Disable further actions until preview arrives
        currentAction = 'waitingForPreview'; // Temporary state
        drawPileDiv.style.pointerEvents = 'none';
        discardPileCard.style.pointerEvents = 'none';

        socket.emit('requestDraw', gameId);
    });

    discardPileCard.addEventListener('click', () => {
        if (!isMyTurn) {
            playerMessage.textContent = 'Not your turn!';
            return;
        }

        // Case 1: Player is previewing a drawn card and clicks discard
        if (currentAction === 'drawnPreview') {
            playerMessage.textContent = 'Discarding and preparing to flip...';
            socket.emit('placeDrawnCard', gameId, { action: 'discardAndFlip' });
            
            // Reset UI immediately (server will send 'mustFlip')
            if (drawnCardPreviewDiv) drawnCardPreviewDiv.classList.add('hidden');
            currentAction = null; 
            discardPileCard.style.pointerEvents = 'none'; // Disable until next state
            return;
        }

        // Case 2: Player is starting their turn or choosing discard pile action
        if (currentAction === null) {
             if (discardPileCard.classList.contains('empty')) {
                playerMessage.textContent = 'Discard pile is empty!';
                return;
            }
            
            currentAction = 'discardSelected';
            selectedCard = 'discard'; // Keep track of selection source
            discardPileCard.classList.add('selected');
            drawPileDiv.classList.remove('selected');
            playerMessage.textContent = 'Selected discard. Click a grid cell to exchange.';

            // Disable draw pile click
            drawPileDiv.style.pointerEvents = 'none';
            
            // Make grid interactive for exchange
             updateGridInteractivity(players); // Pass the global players array
            return;
        }
        
        // Prevent clicking discard pile in other states (e.g., mustFlip)
        playerMessage.textContent = 'Invalid action for discard pile.';
    });

    // Add listeners for shift buttons (mouseover/mouseout)
    shiftHorizontalBtn.addEventListener('mouseenter', () => {
        if (currentAction === 'awaitingShiftChoice') {
            previewShift('horizontal');
        }
    });
    shiftHorizontalBtn.addEventListener('mouseleave', () => {
        if (currentAction === 'awaitingShiftChoice') {
            clearShiftPreview();
        }
    });
    shiftHorizontalBtn.addEventListener('click', () => {
        if (currentAction === 'awaitingShiftChoice') {
            socket.emit('submitShiftChoice', gameId, 'horizontal');
            clearShiftPreview(); // Clear preview on click
            shiftChoiceControls.classList.add('hidden');
            playerMessage.textContent = 'Shift choice submitted...';
        }
    });

    shiftVerticalBtn.addEventListener('mouseenter', () => {
        if (currentAction === 'awaitingShiftChoice') {
            previewShift('vertical');
        }
    });
     shiftVerticalBtn.addEventListener('mouseleave', () => {
        if (currentAction === 'awaitingShiftChoice') {
            clearShiftPreview();
        }
    });
    shiftVerticalBtn.addEventListener('click', () => {
        if (currentAction === 'awaitingShiftChoice') {
            socket.emit('submitShiftChoice', gameId, 'vertical');
            clearShiftPreview(); // Clear preview on click
            shiftChoiceControls.classList.add('hidden');
            playerMessage.textContent = 'Shift choice submitted...';
        }
    });

    newGameBtn.addEventListener('click', () => {
        gameId = null;
        playerId = null;
        playerName = null;
        isMyTurn = false;
        selectedCard = null;
        
        gameOver.classList.add('hidden');
        lobby.classList.remove('hidden');
        
        playerNameInput.value = '';
        gameIdInput.value = '';
        playersUl.innerHTML = '';
        playersList.classList.add('hidden');
        startGameBtn.disabled = true;
    });

    // Initial setup (optional, if needed before game starts)

}); // --- End of DOMContentLoaded --- 


// --- Functions (can be defined outside DOMContentLoaded) --- 

// Initialize player's setup grid
function createPlayerSetupGrid() {
    if (!gridContainer) return; // Add safety check
    gridContainer.innerHTML = '';
    playerGrid = [];
    
    const setupMessage = document.createElement('div');
    setupMessage.classList.add('setup-message');
    setupMessage.innerHTML = '<p>Select 2 cards to flip face up from your grid above</p>';
    
    gridContainer.appendChild(setupMessage);
}

// Update the player's setup grid
function updatePlayerSetupGrid(playerGridData) {
    playerGrid = playerGridData;
    flippedCount = playerGridData.filter(card => !card.faceDown).length;
    
    updateSetupStatus();
    
    socket.emit('requestAllPlayerGrids', gameId);
}

// Update setup status display
function updateSetupStatus() {
    const statusElement = document.getElementById('player-status-setup');
    if (statusElement) {
        statusElement.innerHTML = `
            <p>Cards flipped: ${flippedCount}/2</p>
            ${flippedCount === 2 ? '<p class="ready">Ready! Waiting for others...</p>' : ''}
        `;
    }
    
    const setupPhaseInfo = document.getElementById('setup-phase-info');
    if (setupPhaseInfo) {
        setupPhaseInfo.innerHTML = `
            <h3>Setup Phase</h3>
            <p>Choose 2 cards to flip face-up (${flippedCount}/2 selected)</p>
            ${flippedCount === 2 ? '<p class="ready">Ready! Waiting for others...</p>' : ''}
        `;
    }
}

// Update player progress display
function updatePlayerProgress(playerId, playerName, flippedCount) {
    let progressElement = document.getElementById(`progress-${playerId}`);
    
    if (!progressElement) {
        progressElement = document.createElement('div');
        progressElement.id = `progress-${playerId}`;
        progressElement.classList.add('player-progress');
        const statusSetup = document.getElementById('player-status-setup');
        if (statusSetup) {
            statusSetup.appendChild(progressElement);
        }
    }
    
    progressElement.innerHTML = `
        <p>${playerName}: ${flippedCount}/2</p>
    `;
    
    if (flippedCount === 2) {
        progressElement.classList.add('player-ready');
    }
}

// Update discard pile display
function updateDiscardPile(discardPile) {
    if (!discardPileCard) return; // Add safety check
    if (discardPile.length > 0) {
        const topCard = discardPile[discardPile.length - 1];
        // Use server color if available, otherwise map number to color, fallback to default
        const colorClass = topCard.color || cardColorMap[topCard.number] || 'default-card-color'; 
        discardPileCard.className = 'card ' + colorClass;
        discardPileCard.textContent = topCard ? topCard.number : '?';
        discardPileCard.classList.remove('empty');
    } else {
        discardPileCard.className = 'card empty';
        discardPileCard.textContent = '';
    }
}

// Update player status display
function updatePlayerStatus(players, currentPlayer) {
    if (!playersStatusList) return; // Add safety check
    playersStatusList.innerHTML = '';
    
    players.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.classList.add('player-status');
        
        if (currentPlayer && player.id === currentPlayer.id) {
            playerDiv.classList.add('current');
        }
        
        // Get grid data, which might be shorter after alignments
        const playerGrid = playerGrids[player.id] || []; 
        // Count face-up cards
        const faceUpCards = playerGrid.filter(card => card && !card.faceDown).length; 
        // Get the total number of cards (grid length)
        const totalCards = playerGrid.length;
        
        playerDiv.innerHTML = `
            <h4>${player.name}</h4>
            <div>Total Score: ${player.score}</div>
            <div>Cards: ${faceUpCards}/${totalCards} face up</div>
        `;
        
        playersStatusList.appendChild(playerDiv);
    });
}

// Display all player grids
function displayAllPlayerGrids(playerGridsData, players) {
    // Safeguard: Ensure players is a valid, non-empty array
    if (!Array.isArray(players) || players.length === 0) {
        console.error('displayAllPlayerGrids called with invalid or empty players array:', players);
        return; 
    }

    let allGridsContainer = document.getElementById('all-player-grids');
    if (!allGridsContainer) {
        allGridsContainer = document.createElement('div');
        allGridsContainer.id = 'all-player-grids';
        allGridsContainer.classList.add('all-player-grids');
        
        const gridSection = document.getElementById('grid-section');
        if (gridSection) {
            gridSection.appendChild(allGridsContainer);
        } else if (gameBoard) { 
            gameBoard.appendChild(allGridsContainer);
        } else {
            console.error('Cannot find a place to append all-player-grids container.');
            return;
        }
    }

    allGridsContainer.innerHTML = '';
    const gridTable = document.createElement('div');
    gridTable.classList.add('grid-table');
    const playerLabelsRow = document.createElement('div');
    playerLabelsRow.classList.add('player-labels-row');
    const gridCells = document.createElement('div');
    gridCells.classList.add('grid-cells');

    players.forEach(player => {
        const playerLabel = document.createElement('div');
        playerLabel.classList.add('player-label');
        if (player.id === playerId) {
            playerLabel.classList.add('current-player');
        }
        playerLabel.textContent = player.name;
        playerLabelsRow.appendChild(playerLabel);

        const playerGridContainer = document.createElement('div');
        playerGridContainer.classList.add('player-grid-container');
        if (player.id === playerId) {
            playerGridContainer.classList.add('current-player-grid');
        }

        // Get the actual grid data for this player (could have < 9 cards)
        const currentGridData = playerGridsData[player.id] || [];
        const gridDisplay = document.createElement('div');
        gridDisplay.classList.add('mini-grid');

        // Always render 9 slots
        for (let i = 0; i < 9; i++) {
            const cardElement = document.createElement('div');
            cardElement.classList.add('mini-card');
            
            let isInteractive = false;
            let clickHandler = null;

            // Check if there's a card at this index in the *actual* data
            const card = (i < currentGridData.length) ? currentGridData[i] : null; 

            // If no card data for this slot (either beyond grid length or explicitly null if server logic changes)
            if (card === null) {
                cardElement.classList.add('empty');
                // No text content or further styling needed for empty slots
            } else {
                // It's a valid card, proceed with face-down/face-up logic
                if (card.faceDown) {
                    cardElement.classList.add('back');
                    // The logic for interactivity needs the *original index* if the grid were full.
                    // However, the server now sends compacted grids. We need to map the displayed index (0-8)
                    // back to the actual index within the compacted `currentGridData`.
                    // This interaction logic is now based on the *position* (i) rather than a fixed index mapping.
                    const actualCardIndex = i; // In compacted grid, the loop index IS the card index.
                    
                    // Condition 1: Setup phase flip
                    if (player.id === playerId && gamePhase === 'setup' && flippedCount < 2) {
                        isInteractive = true;
                        // Send the actual index within the current grid array
                        clickHandler = () => { socket.emit('flipCard', gameId, actualCardIndex); }; 
                    }
                    // Condition 2: Play phase, must flip this card
                    else if (player.id === playerId && gamePhase === 'play' && isMyTurn && currentAction === 'mustFlip') {
                        isInteractive = true;
                        cardElement.classList.add('highlight-flip'); 
                        // Send the actual index within the current grid array
                        clickHandler = () => { 
                            socket.emit('flipCard', gameId, actualCardIndex); 
                            resetActionState(players); 
                        }; 
                    }
                    // Condition 3: Play phase, drawn card preview, allow exchange
                     else if (player.id === playerId && gamePhase === 'play' && isMyTurn && currentAction === 'drawnPreview') {
                        isInteractive = true;
                        // Send the actual index within the current grid array
                        clickHandler = () => { 
                            socket.emit('placeDrawnCard', gameId, { action: 'exchangeWithGrid', gridIndex: actualCardIndex });
                            resetActionState(players); 
                        }; 
                    }
                     // Condition 4: Play phase, discard selected, allow exchange
                     else if (player.id === playerId && gamePhase === 'play' && isMyTurn && currentAction === 'discardSelected') {
                        isInteractive = true;
                        // Send the actual index within the current grid array
                        clickHandler = () => { 
                             socket.emit('placeCard', gameId, { source: 'discard', gridIndex: actualCardIndex });
                             resetActionState(players); 
                         }; 
                    }
                    // Condition 7: Play phase, default action is to flip a face-down card
                    else if (player.id === playerId && gamePhase === 'play' && isMyTurn && currentAction === null) {
                        isInteractive = true;
                        // Send the actual index within the current grid array
                        clickHandler = () => { 
                            playerMessage.textContent = 'Flipping card...';
                            socket.emit('flipCard', gameId, actualCardIndex); 
                        }; 
                    }
                } else { // Card is face up
                    const colorClass = card.color || cardColorMap[card.number] || 'blue';
                    cardElement.classList.add(colorClass);
                    cardElement.textContent = card.number;
                    
                    // Interactions for exchanging with face-up cards also need the actual index
                     const actualCardIndex = i;

                    // Condition 5: Play phase, drawn card preview, allow exchange with face-up card
                    if (player.id === playerId && gamePhase === 'play' && isMyTurn && currentAction === 'drawnPreview') {
                         isInteractive = true;
                         clickHandler = () => { 
                             socket.emit('placeDrawnCard', gameId, { action: 'exchangeWithGrid', gridIndex: actualCardIndex });
                             resetActionState(players); 
                         }; 
                    }
                    // Condition 6: Play phase, discard selected, allow exchange with face-up card
                    else if (player.id === playerId && gamePhase === 'play' && isMyTurn && currentAction === 'discardSelected') {
                         isInteractive = true;
                         clickHandler = () => { 
                             socket.emit('placeCard', gameId, { source: 'discard', gridIndex: actualCardIndex });
                             resetActionState(players); 
                         }; 
                    }
                }

                // Disable interaction if awaiting shift choice
                if (currentAction === 'awaitingShiftChoice') {
                    isInteractive = false;
                    clickHandler = null;
                }

                // Add interaction class and listener IF handler is set
                if (isInteractive && clickHandler) {
                    cardElement.classList.add('interactive');
                    // Ensure we remove any old listeners before adding a new one to prevent duplicates
                    // A simple way is to clone and replace the node, but let's try direct assignment first
                    cardElement.onclick = clickHandler; // Assign directly, overwriting previous
                } else {
                     cardElement.classList.remove('interactive');
                     cardElement.onclick = null; // Remove listener if not interactive
                }
            } // End of if (card === null) else block
            
            gridDisplay.appendChild(cardElement);
        } // End of for loop (0-8)
        playerGridContainer.appendChild(gridDisplay);
        gridCells.appendChild(playerGridContainer);
    });

    gridTable.appendChild(playerLabelsRow);
    gridTable.appendChild(gridCells);
    allGridsContainer.appendChild(gridTable);
    allGridsContainer.style.display = 'block';
}

// Helper function to update grid cell interactivity based on current action
function updateGridInteractivity(playersArray = []) {
    // This function will re-run the logic inside displayAllPlayerGrids
    // to add/remove listeners correctly based on the current state (currentAction, isMyTurn)
    // It needs the latest playerGrids and players data.
    // Ensure playersArray is actually an array before calling displayAllPlayerGrids
    const currentPlayers = Array.isArray(playersArray) ? playersArray : []; 
    displayAllPlayerGrids(playerGrids, currentPlayers); 
}

// Helper function to reset UI state after an action is taken or turn ends
function resetActionState(playersArray = []) {
    currentAction = null;
    selectedCard = null;
    currentPendingAlignmentIndices = []; // Clear pending indices
    clearShiftPreview(); // Clear any visible previews

    if (drawnCardPreviewDiv) drawnCardPreviewDiv.classList.add('hidden');
    if (drawPileDiv) {
         drawPileDiv.classList.remove('selected');
         drawPileDiv.style.pointerEvents = 'auto'; // Re-enable
    }
    if (discardPileCard) {
         discardPileCard.classList.remove('selected');
         discardPileCard.style.pointerEvents = 'auto'; // Re-enable
    }
    if (shiftChoiceControls) {
        shiftChoiceControls.classList.add('hidden'); // Ensure shift UI is hidden
    }
    if (playerMessage) playerMessage.textContent = ''; // Clear specific action messages

    // Remove any specific highlighting (like for mustFlip)
    document.querySelectorAll('.highlight-flip').forEach(el => el.classList.remove('highlight-flip'));

    // Update grid interactivity for the default state
    updateGridInteractivity(playersArray);
}

// Function to show shift preview arrows
function previewShift(direction) {
    clearShiftPreview(); // Clear any previous previews first
    const playerGridContainer = document.querySelector('.current-player-grid .mini-grid');
    if (!playerGridContainer || !currentPendingAlignmentIndices) return;

    const alignmentIndicesSet = new Set(currentPendingAlignmentIndices);
    const cards = playerGridContainer.querySelectorAll('.mini-card');

    cards.forEach((card, index) => {
        // Check if the card exists (not an empty slot placeholder beyond the actual grid data)
        // and if it's not one of the cards being removed
        if (!card.classList.contains('empty') && !alignmentIndicesSet.has(index)) {
             card.classList.add(`preview-shift-${direction}`);
        }
    });
}

// Function to clear shift preview arrows
function clearShiftPreview() {
    const playerGridContainer = document.querySelector('.current-player-grid .mini-grid');
    if (!playerGridContainer) return;

    const cards = playerGridContainer.querySelectorAll('.mini-card');
    cards.forEach(card => {
        card.classList.remove('preview-shift-horizontal', 'preview-shift-vertical');
    });
}

// --- Socket Event Handlers (can be defined outside DOMContentLoaded) ---

socket.on('joinedGame', (data) => {
    gameId = data.gameId;
    playerId = data.player.id;
    playerName = data.player.name;
    
    if (playersList) playersList.classList.remove('hidden');
});

socket.on('updatePlayers', (updatedPlayers) => {
    players = updatedPlayers; // Update global players list when lobby changes
    if (!playersUl || !startGameBtn) return;
    playersUl.innerHTML = '';
    players.forEach(player => {
        const li = document.createElement('li');
        li.textContent = player.name;
        playersUl.appendChild(li);
    });
    startGameBtn.disabled = players.length < 2;
});

socket.on('readyToStart', (ready) => {
    if (startGameBtn) startGameBtn.disabled = !ready;
});

socket.on('gameStarted', (data) => {
    if (!lobby || !gameBoard) return;
    lobby.classList.add('hidden');
    gameBoard.classList.remove('hidden');
    
    gamePhase = data.gamePhase;
    playerGrid = data.playerGrid || [];
    if (drawPileCountSpan) drawPileCountSpan.textContent = data.drawPile;
    updateDiscardPile(data.discardPile);
    if (currentPlayerSpan) currentPlayerSpan.textContent = data.currentPlayer.name;
    
    if (gamePhase === 'setup') {
        createPlayerSetupGrid();
        if (drawPileDiv) drawPileDiv.style.pointerEvents = 'none';
        if (discardPileCard) discardPileCard.style.pointerEvents = 'none';
        if (playerMessage) playerMessage.textContent = 'Select 2 cards to flip face up';
    }
    
    if (data.playerGrids) {
        Object.assign(playerGrids, data.playerGrids);
        displayAllPlayerGrids(data.playerGrids, data.players || []);
    } else {
        displayAllPlayerGrids({}, data.players || []);
    }
    
    if (currentRoundSpan) currentRoundSpan.textContent = data.round || 1;
    if(data.players) players = data.players; // Store initial players
});

socket.on('cardFlipped', (data) => {
    playerGrid = data.playerGrid;
    flippedCount = data.flippedCount;
    updateSetupStatus();
    socket.emit('requestAllPlayerGrids', gameId);
});

socket.on('playerProgress', (data) => {
    socket.emit('requestAllPlayerGrids', gameId);
});

socket.on('playPhaseStarted', (data) => {
    gamePhase = 'play';
    isMyTurn = data.currentPlayer.id === playerId;
    if (currentPlayerSpan) currentPlayerSpan.textContent = data.currentPlayer.name;
    
    const setupPhaseInfo = document.getElementById('setup-phase-info');
    if (setupPhaseInfo) {
        setupPhaseInfo.style.display = 'none';
    }
    
    // Commenting out gridContainer styling as it might conflict with the new layout
    /*
    if (gridContainer) {
        gridContainer.style.display = 'grid';
        gridContainer.style.gridTemplateColumns = 'repeat(3, 1fr)';
        gridContainer.style.gridTemplateRows = 'repeat(3, 1fr)';
        gridContainer.style.gap = '10px';
        gridContainer.style.margin = '20px auto';
    }
    */
    
    if (drawPileDiv) drawPileDiv.style.pointerEvents = 'auto';
    if (discardPileCard) discardPileCard.style.pointerEvents = 'auto';
    
    if (playerMessage) {
        if (isMyTurn) {
            playerMessage.textContent = 'Your turn! Draw, take from discard, or flip a grid card.';
        } else {
            playerMessage.textContent = `Waiting for ${data.currentPlayer.name} to make a move.`;
        }
    }
    
    if (data.playerGrids) {
        Object.assign(playerGrids, data.playerGrids);
        displayAllPlayerGrids(data.playerGrids, data.players || []);
    }
    if(data.players) players = data.players; // Update global players
    resetActionState(players); // Pass the updated players array
});

socket.on('gameUpdate', (data) => {
    console.log('Game update received:', data);
    
    if (drawPileCountSpan) drawPileCountSpan.textContent = data.drawPile;
    updateDiscardPile(data.discardPile);
    if (currentPlayerSpan) currentPlayerSpan.textContent = data.currentPlayer.name;
    
    isMyTurn = data.currentPlayer.id === playerId;
    
    updatePlayerStatus(data.players || [], data.currentPlayer);

    if (data.playerGrids) {
        Object.assign(playerGrids, data.playerGrids);
    }
    
    if(data.players) players = data.players; // Update global players
    resetActionState(players); // Pass the updated players array
    
    if (playerMessage) {
        if (isMyTurn) {
            playerMessage.textContent = 'Your turn! Draw, take from discard, or flip a grid card.';
        } else {
            playerMessage.textContent = `Waiting for ${data.currentPlayer.name} to make a move.`;
        }
    }

    // Ensure shift controls are hidden after a general game update
    if (shiftChoiceControls) {
        shiftChoiceControls.classList.add('hidden');
    }
});

socket.on('roundEnd', (data) => {
    if (!gameBoard || !roundEnd) return;
    gameBoard.classList.add('hidden');
    roundEnd.classList.remove('hidden');

    if (!roundScoresDiv || !countdownSpan) return;
    roundScoresDiv.innerHTML = '';
    const sortedPlayers = [...data.players].sort((a, b) => b.score - a.score);

    sortedPlayers.forEach(player => {
        const scoreItem = document.createElement('div');
        scoreItem.classList.add('score-item');
        if (player.id === sortedPlayers[0].id) {
            scoreItem.classList.add('winner');
        }
        let extraInfo = '';
        if (player.id === data.lastDiscarder && data.discardPile.length > 0) {
            const discardPenalty = data.discardPile.reduce((sum, card) => sum + card.number, 0);
            extraInfo = ` (including -${discardPenalty} from discard pile)`;
        }
        scoreItem.innerHTML = `
            <div>${player.name}</div>
            <div>${player.score} points${extraInfo}</div>
        `;
        roundScoresDiv.appendChild(scoreItem);
    });

    let countdown = 5;
    countdownSpan.textContent = countdown;
    const timer = setInterval(() => {
        countdown--;
        countdownSpan.textContent = countdown;
        if (countdown <= 0) {
            clearInterval(timer);
        }
    }, 1000);
});

socket.on('newRound', (data) => {
    if (!roundEnd || !gameBoard) return;
    roundEnd.classList.add('hidden');
    gameBoard.classList.remove('hidden');

    if (currentRoundSpan) currentRoundSpan.textContent = data.round;
    gamePhase = data.gamePhase;
    flippedCount = 0;

    const setupPhaseInfo = document.getElementById('setup-phase-info');
    if (setupPhaseInfo) {
        setupPhaseInfo.style.display = 'block';
        setupPhaseInfo.innerHTML = `
            <h3>Setup Phase</h3>
            <p>Choose 2 cards to flip face-up (${flippedCount}/2 selected)</p>
        `;
    }

    if (gamePhase === 'setup') {
        createPlayerSetupGrid();
        if (drawPileDiv) drawPileDiv.style.pointerEvents = 'none';
        if (discardPileCard) discardPileCard.style.pointerEvents = 'none';
        if (playerMessage) playerMessage.textContent = 'Select 2 cards to flip face up';
    }

    if (drawPileCountSpan) drawPileCountSpan.textContent = data.drawPile;
    updateDiscardPile(data.discardPile);
    if (currentPlayerSpan) currentPlayerSpan.textContent = data.currentPlayer.name;
    isMyTurn = data.currentPlayer.id === playerId;
    updatePlayerStatus(data.players || [], data.currentPlayer);

    if (data.playerGrids) {
        Object.assign(playerGrids, data.playerGrids);
        if(data.players) players = data.players; // Store player list
        displayAllPlayerGrids(data.playerGrids, data.players || []);
    }
    if(data.players) players = data.players; // Update global players
    resetActionState(players); // Pass the updated players array
});

socket.on('gameOver', (data) => {
    if (!gameBoard || !roundEnd || !gameOver) return;
    gameBoard.classList.add('hidden');
    roundEnd.classList.add('hidden');
    gameOver.classList.remove('hidden');

    if (!finalScoresDiv || !winnerAnnouncementDiv) return;
    finalScoresDiv.innerHTML = '';
    data.players.forEach((player, index) => {
        const scoreItem = document.createElement('div');
        scoreItem.classList.add('score-item');
        if (index === 0) {
            scoreItem.classList.add('winner');
        }
        scoreItem.innerHTML = `
            <div>${player.name}</div>
            <div>${player.score} points</div>
        `;
        finalScoresDiv.appendChild(scoreItem);
    });
    winnerAnnouncementDiv.textContent = `${data.winner.name} wins the game!`;
    if(data.players) players = data.players; // Update global players
    resetActionState(players); // Pass the updated players array
});

socket.on('error', (errorMessage) => {
    if (playerMessage) playerMessage.textContent = `Error: ${errorMessage}`;
    // Attempt to reset state on error, might need refinement
    resetActionState([]); 
});

socket.on('playerLeft', (leftPlayerId) => {
    if (playerMessage) playerMessage.textContent = 'A player has left the game.';
});

socket.on('playerGridUpdate', (data) => {
    playerGrid = data.playerGrid || [];
    if (gamePhase === 'setup') {
        updatePlayerSetupGrid(playerGrid);
        socket.emit('requestAllPlayerGrids', gameId);
    }
});

socket.on('allPlayerGrids', (data) => {
    Object.assign(playerGrids, data.playerGrids);
    updatePlayerStatus(data.players, data.currentPlayer);
    displayAllPlayerGrids(data.playerGrids, data.players);
});

socket.on('drawnCardPreview', (data) => {
    if (!isMyTurn) return; // Should only be received by the current player

    const { card, drawPile } = data;

    // Update preview div
    if (drawnCardPreviewDiv) {
        const colorClass = card.color || cardColorMap[card.number] || 'blue';
        drawnCardPreviewDiv.className = 'card ' + colorClass; // Reset classes and add color
        drawnCardPreviewDiv.textContent = card.number;
        drawnCardPreviewDiv.classList.remove('hidden');
    }

    // Update draw pile count display
    if (drawPileCountSpan) drawPileCountSpan.textContent = drawPile;

    // Update state and UI
    currentAction = 'drawnPreview';
    selectedCard = null; // Clear any previous selection visual
    drawPileDiv.classList.remove('selected');
    discardPileCard.classList.remove('selected');
    drawPileDiv.style.pointerEvents = 'none'; // Keep draw disabled
    discardPileCard.style.pointerEvents = 'auto'; // Enable discard pile click

    if (playerMessage) {
        playerMessage.textContent = `Drawn: ${card.number} (${card.color}). Click Discard to discard & flip, or click your grid to exchange.`;
    }

    // Log the players array just before updating interactivity
    console.log('Handling drawnCardPreview. Global players:', players);

    // Make grid interactive for exchange
    updateGridInteractivity(players); // Pass the global players array
});

socket.on('mustFlip', (data) => {
    if (!isMyTurn) return;

    // Update discard pile if needed (server sends it)
    if (data.discardPile) {
        updateDiscardPile(data.discardPile);
    }
     // Update grids if needed (server sends it)
    if (data.playerGrids && data.players) {
         Object.assign(playerGrids, data.playerGrids);
         displayAllPlayerGrids(data.playerGrids, data.players);
    }

    currentAction = 'mustFlip';
    if (playerMessage) {
        playerMessage.textContent = data.message || 'Select a face-down card from your grid to flip.';
    }

    // Disable draw/discard clicks
    drawPileDiv.style.pointerEvents = 'none';
    discardPileCard.style.pointerEvents = 'none';
    
    // Make only face-down grid cards interactive
    if(data.players) players = data.players; // Update global players
    updateGridInteractivity(players); // Pass the updated players array
});

socket.on('lastRoundTriggered', (data) => {
    if (playerMessage) {
        const triggerer = players.find(p => p.id === data.triggererId);
        const triggererName = triggerer ? triggerer.name : 'The draw pile being empty';
        playerMessage.textContent = `Last round triggered by ${triggererName}! Each remaining player gets one more turn.`;
    }
    // No state change needed on client, just informational message
});

// Add a partial update handler
socket.on('gameUpdatePartial', (data) => {
    // Update parts of the UI without affecting turn state
    if (typeof data.drawPile !== 'undefined' && drawPileCountSpan) {
        drawPileCountSpan.textContent = data.drawPile;
    }
    if (data.discardPile) {
        updateDiscardPile(data.discardPile);
    }
    if (data.playerGrids && typeof players !== 'undefined') { // Ensure players array is available
        Object.assign(playerGrids, data.playerGrids);
        // Need the current list of players to pass to displayAllPlayerGrids
        // Fetch it or ensure it's stored reliably client-side
        // For now, let's assume `players` variable holds the latest list
        const currentPlayers = players || []; // Use a local variable if players is accessible
        displayAllPlayerGrids(data.playerGrids, currentPlayers); 
    }
});

// Listen for server prompt to choose shift direction
socket.on('promptShiftChoice', (data) => {
    if (!isMyTurn) return; // Only the current player should see this

    console.log('Prompted for shift choice:', data.message, 'Indices:', data.indices);
    currentAction = 'awaitingShiftChoice';
    currentPendingAlignmentIndices = data.indices || []; // Store the indices

    // Show shift controls
    if (shiftChoiceControls) {
        shiftChoiceControls.classList.remove('hidden');
    }
    if (playerMessage) {
        playerMessage.textContent = data.message || 'Alignment found! Choose shift direction.';
    }

    // Disable other actions
    if (drawPileDiv) drawPileDiv.style.pointerEvents = 'none';
    if (discardPileCard) discardPileCard.style.pointerEvents = 'none';
    if (drawnCardPreviewDiv) drawnCardPreviewDiv.classList.add('hidden'); // Hide preview if it was up

    // Update grid to disable interactivity and clear any previews initially
    clearShiftPreview();
    updateGridInteractivity(players);
});