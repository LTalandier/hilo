# Hilo Card Game

An online multiplayer card game based on Hilo rules, implemented with Node.js, Socket.io, and vanilla HTML/CSS/JavaScript.

## Game Overview

Hilo is a card game for 2-6 players where players take turns placing or retrieving cards from a grid, aiming to align cards of the same color. The goal is to score points by creating alignments while managing a draw pile and discard pile.

## Setup Instructions

### Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)

### Installation

1. Clone the repository or download the source code
2. Open a terminal in the project directory
3. Install dependencies:

```bash
npm install
```

### Running the Game

To start the server:

```bash
npm start
```

For development with auto-restart:

```bash
npm run dev
```

The game will be available at `http://localhost:3000` by default. If you want to use a different port, you can set the `PORT` environment variable.

### Deploying to a VPS

1. Transfer the project files to your VPS using SCP, SFTP, or Git
2. Install dependencies with `npm install`
3. Start the server with `npm start` or use a process manager like PM2:

```bash
npm install -g pm2
pm2 start server.js --name hilo-game
```

## How to Play

1. Open the game URL in your browser
2. Enter your name and either create a new game ID or join an existing one
3. Share the game ID with friends so they can join
4. Once 2 or more players have joined, the game can be started
5. Take turns placing cards on the grid or retrieving cards from the discard pile
6. The round ends when someone has no card or all his card are flipped
7. The game ends when a player score reaches 100
8. The player with the lowest score wins!

## Game Rules

- **Alignments**: when 3 cards of the same color are aligned face up in the grid (horizontal, vertical, or diagonal) the 3 card are then removed
- **Turn Options**:
  - Draw a card watch it and put it directly in the discard, then flip a face down card from the grid
  - Draw a card watch it and put it in the grid, the old card from the grid is send to the discard
  - Take a card from the discard pile and exchange it with a card on the grid
  - flip a face down card from the grid 
- **End of Round**: When someone has no card or when has all his card face up, then one last turn for each other players and then the game is stopped
- **Scoring**: All the card number of each players are summed up to get round score and then round scores are summed up with previous round scores to get game scores
- **end of game**: Game ends when a player get 100 game score he then loses, the player with lowest score wins
## License

This project is open source and available under the [MIT License](LICENSE). 