/**
 * DARK - AlphaZero Chinese Dark Chess Web Engine
 */

const PIECE_DATA = {
    'red': [['帥', 7], ['仕', 6], ['相', 5], ['俥', 4], ['傌', 3], ['炮', 2], ['兵', 1]],
    'black': [['將', 7], ['士', 6], ['象', 5], ['車', 4], ['馬', 3], ['包', 2], ['卒', 1]]
};

class Game {
    constructor() {
        this.board = Array(4).fill(null).map(() => Array(8).fill(null));
        this.turn = 'red';
        this.selected = null;
        this.history = [];
        this.isGameOver = false;
        this.aiLevel = 400; // MCTS Simulations
        this.session = null; // ONNX Session
        
        this.initBoard();
        this.render();
        this.initAI();
        this.setupListeners();
    }

    async initAI() {
        this.updateStatus("正在加載 AI 大腦...");
        try {
            // 注意：這裡假設 model.onnx 位於網頁根目錄
            this.session = await ort.InferenceSession.create('./model.onnx');
            this.updateStatus("AI 就緒，請開始你的表演");
        } catch (e) {
            this.updateStatus("AI 加載失敗 (請確保 model.onnx 已導出並上傳)");
            console.error(e);
        }
    }

    initBoard() {
        let pool = [];
        for (const [color, pieces] of Object.entries(PIECE_DATA)) {
            for (const [name, level] of pieces) {
                let count = (level === 7) ? 1 : (level === 1 ? 5 : 2);
                for (let i = 0; i < count; i++) {
                    pool.push({ name, level, color, revealed: false });
                }
            }
        }
        // Shuffle
        pool.sort(() => Math.random() - 0.5);
        
        let idx = 0;
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 8; c++) {
                this.board[r][c] = pool[idx++];
            }
        }
    }

    setupListeners() {
        document.getElementById('reset-btn').onclick = () => location.reload();
        document.getElementById('board').onclick = (e) => this.handleBoardClick(e);
    }

    handleBoardClick(e) {
        if (this.isGameOver || this.turn === 'black') return;

        const cell = e.target.closest('.cell');
        if (!cell) return;

        const r = parseInt(cell.dataset.r);
        const c = parseInt(cell.dataset.c);
        const piece = this.board[r][c];

        if (!piece) {
            // Clicked empty cell
            if (this.selected) this.tryMove(this.selected, [r, c]);
            return;
        }

        if (!piece.revealed) {
            // Flip piece
            this.flipPiece(r, c);
            this.nextTurn();
        } else if (piece.color === this.turn) {
            // Select piece
            this.selected = [r, c];
            this.render();
        } else if (this.selected) {
            // Try capture
            this.tryMove(this.selected, [r, c]);
        }
    }

    flipPiece(r, c) {
        this.board[r][c].revealed = true;
        this.history.push({ type: 'flip', pos: [r, c], player: this.turn });
        this.render();
    }

    tryMove(from, to) {
        const [sr, sc] = from;
        const [tr, tc] = to;
        if (this.canMove(sr, sc, tr, tc)) {
            const captured = this.board[tr][tc];
            this.board[tr][tc] = this.board[sr][sc];
            this.board[sr][sc] = null;
            this.history.push({ type: 'move', from, to, player: this.turn, captured: captured ? captured.name : null });
            this.selected = null;
            this.render();
            this.nextTurn();
        }
    }

    canMove(sr, sc, tr, tc) {
        const a = this.board[sr][sc];
        const t = this.board[tr][tc];
        const dist = Math.abs(sr - tr) + Math.abs(sc - tc);

        if (a.level === 2) { // 炮
            if (t && t.revealed && t.color !== a.color) {
                let cnt = 0;
                if (sr === tr) {
                    for (let i = Math.min(sc, tc) + 1; i < Math.max(sc, tc); i++) if (this.board[sr][i]) cnt++;
                } else if (sc === tc) {
                    for (let i = Math.min(sr, tr) + 1; i < Math.max(sr, tr); i++) if (this.board[i][sc]) cnt++;
                } else return false;
                return cnt === 1;
            }
            return !t && dist === 1;
        }

        if (dist !== 1) return false;
        if (!t) return true;
        if (t.revealed && t.color !== a.color) {
            if (a.level === 7 && t.level === 1) return false;
            if (a.level === 1 && t.level === 7) return true;
            return a.level >= t.level;
        }
        return false;
    }

    async nextTurn() {
        const winner = this.checkWinner();
        if (winner) {
            this.endGame(winner);
            return;
        }

        this.turn = (this.turn === 'red') ? 'black' : 'red';
        this.render();

        if (this.turn === 'black') {
            await this.aiMove();
        }
    }

    async aiMove() {
        this.updateStatus("AI 正在深度思考...");
        
        // --- 這裡將來會運行 MCTS 邏輯 ---
        // 目前先用一個隨機邏輯作為占位符，確保遊戲可玩
        const moves = this.getValidMoves('black');
        if (moves.length === 0) {
            this.endGame('red');
            return;
        }

        await new Promise(r => setTimeout(r, 1000)); // 模擬思考

        const move = moves[Math.floor(Math.random() * moves.length)];
        if (move.type === 'flip') {
            this.flipPiece(move.pos[0], move.pos[1]);
        } else {
            this.board[move.to[0]][move.to[1]] = this.board[move.from[0]][move.from[1]];
            this.board[move.from[0]][move.from[1]] = null;
            this.history.push(move);
        }

        this.nextTurn();
    }

    getValidMoves(player) {
        let moves = [];
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                if (!p) continue;
                if (!p.revealed) {
                    moves.push({ type: 'flip', pos: [r, c], player });
                } else if (p.color === player) {
                    // Check moves
                    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
                    for (let [dr, dc] of dirs) {
                        let tr = r + dr, tc = c + dc;
                        if (tr >= 0 && tr < 4 && tc >= 0 && tc < 8 && this.canMove(r, c, tr, tc)) {
                            moves.push({ type: 'move', from: [r, c], to: [tr, tc], player, captured: this.board[tr][tc] ? this.board[tr][tc].name : null });
                        }
                    }
                    if (p.level === 2) { // 炮的特殊跳躍
                        for (let tr = 0; tr < 4; tr++) if (this.canMove(r, c, tr, c)) moves.push({ type: 'move', from: [r, c], to: [tr, c], player, captured: this.board[tr][c] ? this.board[tr][c].name : null });
                        for (let tc = 0; tc < 8; tc++) if (this.canMove(r, c, r, tc)) moves.push({ type: 'move', from: [r, c], to: [r, tc], player, captured: this.board[r][tc] ? this.board[r][tc].name : null });
                    }
                }
            }
        }
        return moves;
    }

    checkWinner() {
        const hasRed = this.board.flat().some(p => p && p.color === 'red');
        const hasBlack = this.board.flat().some(p => p && p.color === 'black');
        if (!hasRed) return 'black';
        if (!hasBlack) return 'red';
        return null;
    }

    async endGame(winner) {
        this.isGameOver = true;
        this.updateStatus(`遊戲結束！${winner === 'red' ? '紅方' : '黑方'} 獲勝`);
        alert(`恭喜！${winner === 'red' ? '紅方' : '黑方'} 獲勝`);
        
        // 上傳資料到 Google Sheets
        await this.uploadData(winner);
    }

    async uploadData(winner) {
        const url = "__GOOGLE_SCRIPT_URL__"; // GitHub Actions 會替換此處
        if (url.startsWith("__")) return; 

        const payload = {
            winner,
            steps: this.history.length,
            history: this.history
        };

        try {
            await fetch(url, {
                method: 'POST',
                mode: 'no-cors',
                body: JSON.stringify(payload)
            });
            this.log("棋譜已上傳至雲端");
        } catch (e) {
            console.error("上傳失敗", e);
        }
    }

    updateStatus(msg) {
        document.getElementById('ai-status').innerText = msg;
        this.log(msg);
    }

    log(msg) {
        const logDiv = document.getElementById('game-log');
        const entry = document.createElement('div');
        entry.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
        logDiv.prepend(entry);
    }

    render() {
        const boardEl = document.getElementById('board');
        boardEl.innerHTML = '';
        
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 8; c++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.r = r;
                cell.dataset.c = c;
                
                const piece = this.board[r][c];
                if (piece) {
                    const pieceEl = document.createElement('div');
                    pieceEl.className = `piece ${piece.revealed ? 'revealed ' + piece.color : 'hidden'}`;
                    if (piece.revealed) pieceEl.innerText = piece.name;
                    if (this.selected && this.selected[0] === r && this.selected[1] === c) {
                        pieceEl.classList.add('selected');
                    }
                    cell.appendChild(pieceEl);
                }
                boardEl.appendChild(cell);
            }
        }

        // Update active player UI
        document.querySelector('.player-info.red').classList.toggle('active', this.turn === 'red');
        document.querySelector('.player-info.black').classList.toggle('active', this.turn === 'black');
    }
}

window.onload = () => new Game();
