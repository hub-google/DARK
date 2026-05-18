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
        this.lastMove = null;
        this.movesSinceProgress = 0;
        this.history = [];
        this.historyHashes = new Map(); // 💡 追蹤盤面 Hash 歷史
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
            // 加入時間戳記避免瀏覽器快取舊版 18通道模型，強制拉取最新 34通道模型
            this.session = await ort.InferenceSession.create('./model.onnx?t=' + Date.now());
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

        this.movesSinceProgress = 0; // 翻子視為進展
        this.historyHashes.clear();  // 💡 不可逆動作，清空歷史
        this.history.push({ type: 'flip', pos: [r, c], player: this.turn, name: piece.name });

        this.render();
        this.nextTurn();
    }

    // 💡 獲取當前盤面的 Hash (加上輪次)
    getBoardHash(board, turn) {
        let s = "";
        for (let r=0; r<4; r++) {
            for (let c=0; c<8; c++) {
                const p = board[r][c];
                if (!p) s += "0";
                else if (!p.revealed) s += "X";
                else s += (p.color === 'red' ? '' : '-') + p.level;
            }
        }
        return s + "|" + turn;
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
            
            if (captured) {
                this.movesSinceProgress = 0; // 吃子視為進展
                this.historyHashes.clear();  // 💡 吃子不可逆，清空歷史
            } else {
                this.movesSinceProgress++;
                const h = this.getBoardHash(this.board, (this.turn === 'red' ? 'black' : 'red'));
                this.historyHashes.set(h, (this.historyHashes.get(h) || 0) + 1);
            }
            
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
        const { winner, reason } = this.checkWinner();
        if (winner) {
            this.endGame(winner, reason);
            return;
        }

        if (this.turn === 'first') {
            this.turn = this.aiColor;
        } else {
            this.turn = (this.turn === 'red') ? 'black' : 'red';
        }
        
        // 初始狀態記錄
        if (this.historyHashes.size === 0) {
            this.historyHashes.set(this.getBoardHash(this.board, this.turn), 1);
        }

        this.render();

        if (this.turn === this.aiColor && !this.isGameOver) {
            await this.aiMove();
        }
    }

    // ==========================================
    // AI 推理引擎 (對齊 train_ai.py 的 board_to_tensor)
    // ==========================================

    boardToTensor(board, turn, lastMove) {
        // 💡 升級為 34 通道 x 4 x 8，與 train_ai.py 的 get_tensor 完全對齊
        const tensor = new Float32Array(34 * 4 * 8);
        const idx = (ch, r, c) => ch * 32 + r * 8 + c;

        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 8; c++) {
                const p = board[r][c];
                if (!p) continue;
                if (!p.revealed) {
                    tensor[idx(14, r, c)] = 1.0; // 通道 14: 蓋棋
                } else {
                    const pv = 8 - p.level; // 對齊 Python: 1 (帥/將) ~ 7 (兵/卒)
                    if (p.color === 'red') {
                        tensor[idx(pv - 1, r, c)] = 1.0; // 通道 0-6: 紅棋 (帥仕相俥傌炮兵)
                    } else {
                        tensor[idx(pv + 6, r, c)] = 1.0; // 通道 7-13: 黑棋 (將士象車馬包卒)
                    }
                }
            }
        }

        // 通道 15: 輪到紅方
        if (turn === 'red') {
            for (let i = 0; i < 32; i++) tensor[15 * 32 + i] = 1.0;
        }

        // 通道 16-17: 舊版最後一手標記，保留為 0 (新版不使用但佔位)

        // 通道 18-31: 信念池 (未翻開棋子比例)
        const pool = { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0, [-1]:0, [-2]:0, [-3]:0, [-4]:0, [-5]:0, [-6]:0, [-7]:0 };
        let total_h = 0;
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 8; c++) {
                const p = board[r][c];
                if (p && !p.revealed) {
                    const pv = p.color === 'red' ? (8 - p.level) : -(8 - p.level);
                    pool[pv] = (pool[pv] || 0) + 1;
                    total_h++;
                }
            }
        }
        if (total_h < 1) total_h = 1;

        const pvs = [1, 2, 3, 4, 5, 6, 7, -1, -2, -3, -4, -5, -6, -7];
        for (let i = 0; i < 14; i++) {
            const ratio = (pool[pvs[i]] || 0) / total_h;
            for (let cell = 0; cell < 32; cell++) {
                tensor[(18 + i) * 32 + cell] = ratio;
            }
        }

        // 通道 32-33: 合法移動目的地標記
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 8; c++) {
                const p = board[r][c];
                if (p && p.revealed) {
                    const i = p.color === 'red' ? 0 : 1;
                    const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
                    for (let [dr, dc] of dirs) {
                        let tr = r + dr, tc = c + dc;
                        if (tr >= 0 && tr < 4 && tc >= 0 && tc < 8 && this.canMove(board, r, c, tr, tc)) {
                            tensor[idx(32 + i, tr, tc)] = 1.0;
                        }
                    }
                    if (p.level === 2) { // 炮跳子
                        for (let tr = 0; tr < 4; tr++) if (this.canMove(board, r, c, tr, c)) tensor[idx(32 + i, tr, c)] = 1.0;
                        for (let tc = 0; tc < 8; tc++) if (this.canMove(board, r, c, r, tc)) tensor[idx(32 + i, r, tc)] = 1.0;
                    }
                }
            }
        }

        return tensor;
    }

    actionToId(move) {
        if (move.type === 'flip') {
            const [r, c] = move.pos;
            return r * 8 + c; // 0~31
        } else {
            const [sr, sc] = move.from;
            const [tr, tc] = move.to;
            const fromIdx = sr * 8 + sc;
            const toIdx   = tr * 8 + tc;
            return 32 + fromIdx * 32 + toIdx; // 32~1055
        }
    }

    async runInference(board, turn, lastMove) {
        if (!this.session) return null;
        try {
            const tensorData = this.boardToTensor(board, turn, lastMove);
            const inputTensor = new ort.Tensor('float32', tensorData, [1, 34, 4, 8]);
            const output = await this.session.run({ input: inputTensor });
            // policy 輸出為 logits，需要 softmax
            const logits = output.policy ? output.policy.data : Object.values(output)[0].data;
            const maxL = Math.max(...logits);
            const exps = Array.from(logits).map(x => Math.exp(x - maxL));
            const sumE = exps.reduce((a, b) => a + b, 0);
            return exps.map(x => x / sumE); // 回傳機率分布
        } catch(e) {
            console.error('ONNX inference error:', e);
            return null;
        }
    }

    async aiMove() {
        this.updateStatus('AI 正在思考...');
        await new Promise(r => setTimeout(r, 600));

        const { normal: moves, repMoves } = this.getValidMoves(this.aiColor);
        
        if (moves.length === 0) {
            if (repMoves.length > 0) this.endGame('draw', '只剩禁手步');
            else this.endGame(this.playerColor, '無棋可走');
            return;
        }

        let chosenMove = null;
        const probs = await this.runInference(this.board, this.aiColor, this.lastMove);
        if (probs) {
            let bestProb = -1;
            for (const move of moves) {
                const aid = this.actionToId(move);
                if (probs[aid] > bestProb) {
                    bestProb = probs[aid];
                    chosenMove = move;
                }
            }
        } else {
            chosenMove = moves[Math.floor(Math.random() * moves.length)];
        }

        // 執行走步
        if (chosenMove.type === 'flip') {
            const piece = this.board[chosenMove.pos[0]][chosenMove.pos[1]];
            piece.revealed = true;
            this.historyHashes.clear(); // 💡 翻牌清空歷史
            this.history.push({ ...chosenMove, name: piece.name });
            this.movesSinceProgress = 0;
            this.lastMove = chosenMove;
        } else {
            const piece    = this.board[chosenMove.from[0]][chosenMove.from[1]];
            const captured = this.board[chosenMove.to[0]][chosenMove.to[1]];
            this.board[chosenMove.to[0]][chosenMove.to[1]] = piece;
            this.board[chosenMove.from[0]][chosenMove.from[1]] = null;
            
            if (captured) {
                this.movesSinceProgress = 0;
                this.historyHashes.clear(); // 💡 吃子清空歷史
            } else {
                this.movesSinceProgress++;
                const h = this.getBoardHash(this.board, this.playerColor);
                this.historyHashes.set(h, (this.historyHashes.get(h) || 0) + 1);
            }
            this.history.push({ ...chosenMove, piece: piece.name, captured: captured?.name ?? null });
            this.lastMove = chosenMove;
        }

        this.render();
        this.nextTurn();
    }

    getValidMoves(player) {
        let normal = [], repMoves = [];
        const nextTurn = (player === 'red' ? 'black' : 'red');

        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                if (!p) continue;
                if (!p.revealed) {
                    normal.push({ type: 'flip', pos: [r, c], player });
                } else if (p.color === player) {
                    const candidates = [];
                    const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
                    for (let [dr, dc] of dirs) {
                        let tr = r + dr, tc = c + dc;
                        if (tr >= 0 && tr < 4 && tc >= 0 && tc < 8 && this.canMove(this.board, r, c, tr, tc)) {
                            candidates.push({ type: 'move', from: [r, c], to: [tr, tc], player });
                        }
                    }
                    if (p.level === 2) { 
                        for (let tr = 0; tr < 4; tr++) if (this.canMove(this.board, r, c, tr, c)) candidates.push({ type: 'move', from: [r, c], to: [tr, c], player });
                        for (let tc = 0; tc < 8; tc++) if (this.canMove(this.board, r, c, r, tc)) candidates.push({ type: 'move', from: [r, c], to: [r, tc], player });
                    }

                    // 💡 檢查禁手規則
                    for (let m of candidates) {
                        const tempB = JSON.parse(JSON.stringify(this.board));
                        const [sr, sc] = m.from; const [tr, tc] = m.to;
                        tempB[tr][tc] = tempB[sr][sc]; tempB[sr][sc] = null;
                        const h = this.getBoardHash(tempB, nextTurn);
                        if (this.historyHashes.get(h) >= 2) repMoves.push(m);
                        else normal.push(m);
                    }
                }
            }
        }
        return { normal, repMoves };
    }

    checkWinner() {
        const redPieces   = this.board.flat().filter(p => p && p.color === 'red').length;
        const blackPieces = this.board.flat().filter(p => p && p.color === 'black').length;
        if (redPieces === 0)   return { winner: 'black', reason: '吃光所有紅棋' };
        if (blackPieces === 0) return { winner: 'red', reason: '吃光所有黑棋' };

        // 💡 檢查當前玩家是否無棋可走或只剩禁手
        const { normal, repMoves } = this.getValidMoves(this.turn);
        if (normal.length === 0) {
            if (repMoves.length > 0) return { winner: 'draw', reason: '三重複禁手強制和局' };
            return { winner: (this.turn === 'red' ? 'black' : 'red'), reason: '困斃（無合法棋步）' };
        }

        if (this.movesSinceProgress >= 30) return { winner: 'draw', reason: '30步無進展' };
        return { winner: null };
    }


    async endGame(winner, reason) {
        this.isGameOver = true;
        let msg = "";
        if (winner === 'draw') msg = `平手！(${reason})`;
        else msg = `遊戲結束！${winner === 'red' ? '紅方' : '黑方'} 獲勝 (${reason})`;
        
        this.updateStatus(msg);
        alert(msg);
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
            const redEl = document.querySelector('.player-info.red');
            const blackEl = document.querySelector('.player-info.black');
            
            // 動態修正標籤文字，防止定色後 UI 顯示錯誤
            if (this.playerColor === 'red') {
                redEl.innerHTML = '<span class="dot"></span> 紅方 (你)';
                blackEl.innerHTML = '黑方 (AI) <span class="dot"></span>';
            } else {
                redEl.innerHTML = '<span class="dot"></span> 紅方 (AI)';
                blackEl.innerHTML = '黑方 (你) <span class="dot"></span>';
            }
            
            redEl.classList.toggle('active', this.turn === 'red');
            blackEl.classList.toggle('active', this.turn === 'black');
        }
    }
}

window.onload = () => new Game();
