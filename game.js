/**
 * DARK - AlphaZero Chinese Dark Chess Web Engine
 * Logic synchronized with train_ai.py
 */

class Game {
    constructor() {
        this.board = Array(4).fill(null).map(() => Array(8).fill(null));
        this.turn = 'first'; // First move/flip decides color
        this.playerColor = null;
        this.aiColor = null;
        this.selected = null;
        this.history = [];
        this.isGameOver = false;
        this.session = null;
        
        this.initBoard();
        this.render();
        this.initAI();
        this.setupListeners();
    }

    async initAI() {
        this.updateStatus("正在加載 AI 大腦...");
        try {
            this.session = await ort.InferenceSession.create('./model.onnx');
            this.updateStatus("AI 就緒，由你先手翻牌");
        } catch (e) {
            this.updateStatus("AI 加載失敗 (請確保已導出 model.onnx)");
            console.error(e);
        }
    }

    initBoard() {
        let pool = [];
        const piecesInfo = [
            {name: '帥', level: 7, color: 'red', count: 1}, {name: '仕', level: 6, color: 'red', count: 2},
            {name: '相', level: 5, color: 'red', count: 2}, {name: '俥', level: 4, color: 'red', count: 2},
            {name: '傌', level: 3, color: 'red', count: 2}, {name: '炮', level: 2, color: 'red', count: 2},
            {name: '兵', level: 1, color: 'red', count: 5},
            {name: '將', level: 7, color: 'black', count: 1}, {name: '士', level: 6, color: 'black', count: 2},
            {name: '象', level: 5, color: 'black', count: 2}, {name: '車', level: 4, color: 'black', count: 2},
            {name: '馬', level: 3, color: 'black', count: 2}, {name: '包', level: 2, color: 'black', count: 2},
            {name: '卒', level: 1, color: 'black', count: 5}
        ];
        for (let p of piecesInfo) {
            for (let i = 0; i < p.count; i++) pool.push({...p, revealed: false});
        }
        pool.sort(() => Math.random() - 0.5);
        let idx = 0;
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 8; c++) this.board[r][c] = pool[idx++];
        }
    }

    setupListeners() {
        document.getElementById('reset-btn').onclick = () => location.reload();
        document.getElementById('board').onclick = (e) => this.handleBoardClick(e);
    }

    handleBoardClick(e) {
        if (this.isGameOver) return;
        
        // 嚴格限制：只有輪到玩家時才能操作
        if (this.turn === 'first' || this.turn === this.playerColor) {
            const cell = e.target.closest('.cell');
            if (!cell) return;

            const r = parseInt(cell.dataset.r);
            const c = parseInt(cell.dataset.c);
            const piece = this.board[r][c];

            // 1. 翻牌邏輯：任何隱藏子都能翻
            if (piece && !piece.revealed) {
                this.flipPiece(r, c);
                return;
            }

            // 2. 選取與移動邏輯
            if (this.turn === 'first') return; 

            // 修正：選取時必須確認是自己的顏色
            if (piece && piece.revealed && piece.color === this.playerColor) {
                this.selected = [r, c];
                this.render();
            } else if (this.selected) {
                // 移動目標可以是空地或對手的子（吃子）
                this.tryMove(this.selected, [r, c]);
            }
        }
    }

    flipPiece(r, c) {
        const piece = this.board[r][c];
        piece.revealed = true;
        
        // 首翻定色
        if (this.turn === 'first') {
            this.playerColor = piece.color;
            this.aiColor = (piece.color === 'red') ? 'black' : 'red';
            this.updateStatus(`首翻定色：你是 ${piece.color === 'red' ? '紅方' : '黑方'}`);
        }

        this.history.push({ type: 'flip', pos: [r, c], player: this.turn, name: piece.name });
        this.render();
        this.nextTurn();
    }

    tryMove(from, to) {
        const [sr, sc] = from;
        const [tr, tc] = to;
        const piece = this.board[sr][sc];

        // 二次檢查：確保移動的是自己的棋子，且目前是自己的回合
        if (piece && piece.color === this.turn && this.canMove(this.board, sr, sc, tr, tc)) {
            const captured = this.board[tr][tc];
            this.board[tr][tc] = piece;
            this.board[sr][sc] = null;
            this.history.push({ type: 'move', from, to, player: this.turn, piece: piece.name, captured: captured ? captured.name : null });
            this.selected = null;
            this.render();
            this.nextTurn();
        } else {
            this.selected = null;
            this.render();
        }
    }


    canMove(b, sr, sc, tr, tc) {
        const a = b[sr][sc];
        const t = b[tr][tc];
        if (!a || !a.revealed) return false;
        const dist = Math.abs(sr - tr) + Math.abs(sc - tc);

        if (a.level === 2) { // Cannon
            if (t && t.revealed && t.color !== a.color) {
                let cnt = 0;
                if (sr === tr) {
                    for (let i = Math.min(sc, tc) + 1; i < Math.max(sc, tc); i++) if (b[sr][i]) cnt++;
                } else if (sc === tc) {
                    for (let i = Math.min(sr, tr) + 1; i < Math.max(sr, tr); i++) if (b[i][sc]) cnt++;
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

        // Cycle turn: first -> colorA -> colorB -> ...
        if (this.turn === 'first') {
            // After first flip, turn goes to the OTHER color
            this.turn = this.aiColor;
        } else {
            this.turn = (this.turn === 'red') ? 'black' : 'red';
        }
        
        this.render();

        if (this.turn === this.aiColor && !this.isGameOver) {
            await this.aiMove();
        }
    }

    async aiMove() {
        this.updateStatus("AI 正在深度思考...");
        await new Promise(r => setTimeout(r, 1000));

        const moves = this.getValidMoves(this.aiColor);
        if (moves.length === 0) {
            this.endGame(this.playerColor);
            return;
        }

        // TODO: Integrate MCTS/ONNX here for real AI
        const move = moves[Math.floor(Math.random() * moves.length)];
        if (move.type === 'flip') {
            const piece = this.board[move.pos[0]][move.pos[1]];
            piece.revealed = true;
            this.history.push({ ...move, name: piece.name });
        } else {
            const piece = this.board[move.from[0]][move.from[1]];
            const captured = this.board[move.to[0]][move.to[1]];
            this.board[move.to[0]][move.to[1]] = piece;
            this.board[move.from[0]][move.from[1]] = null;
            this.history.push({ ...move, piece: piece.name, captured: captured ? captured.name : null });
        }

        this.render();
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
                    const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
                    for (let [dr, dc] of dirs) {
                        let tr = r + dr, tc = c + dc;
                        if (tr >= 0 && tr < 4 && tc >= 0 && tc < 8 && this.canMove(this.board, r, c, tr, tc)) {
                            moves.push({ type: 'move', from: [r, c], to: [tr, tc], player });
                        }
                    }
                    if (p.level === 2) { 
                        for (let tr = 0; tr < 4; tr++) if (this.canMove(this.board, r, c, tr, c)) moves.push({ type: 'move', from: [r, c], to: [tr, c], player });
                        for (let tc = 0; tc < 8; tc++) if (this.canMove(this.board, r, c, r, tc)) moves.push({ type: 'move', from: [r, c], to: [r, tc], player });
                    }
                }
            }
        }
        return moves;
    }

    checkWinner() {
        const redPieces = this.board.flat().filter(p => p && p.color === 'red').length;
        const blackPieces = this.board.flat().filter(p => p && p.color === 'black').length;
        if (redPieces === 0) return 'black';
        if (blackPieces === 0) return 'red';
        return null;
    }

    async endGame(winner) {
        this.isGameOver = true;
        const winnerName = winner === 'red' ? '紅方' : '黑方';
        this.updateStatus(`遊戲結束！${winnerName} 獲勝`);
        alert(`遊戲結束！${winnerName} 獲勝`);
        await this.uploadData(winner);
    }

    async uploadData(winner) {
        const url = "https://script.google.com/macros/s/AKfycby16bcSzU4wtsMQ1WszgeS6SGOGepJEITNIAOX-MSfMZj7OvqTsuNv9buoVAW1_aEllxg/exec";
        if (!url || url.startsWith("__")) return; 
        const payload = { winner, steps: this.history.length, history: this.history };
        try {
            await fetch(url, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) });
            this.log("棋譜已上傳至雲端");
        } catch (e) { console.error("上傳失敗", e); }
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
                    if (this.selected && this.selected[0] === r && this.selected[1] === c) pieceEl.classList.add('selected');
                    cell.appendChild(pieceEl);
                }
                boardEl.appendChild(cell);
            }
        }
        if (this.playerColor) {
            document.querySelector('.player-info.red').classList.toggle('active', this.turn === 'red');
            document.querySelector('.player-info.black').classList.toggle('active', this.turn === 'black');
        }
    }
}

window.onload = () => new Game();
