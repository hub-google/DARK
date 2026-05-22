/**
 * DARK - AlphaZero Chinese Dark Chess Web Engine
 * Logic synchronized with train_ai.py
 */

class MCTSNode {
    constructor(p, parent = null, move = null) {
        this.p = p;          // 💡 先驗機率 (Prior Probability)
        this.parent = parent;
        this.move = move;
        this.children = new Map(); // actionId -> MCTSNode
        this.v = 0;          // 💡 訪問次數 (Visit Count)
        this.vs = 0.0;       // 💡 累積價值價值總和 (Value Sum)
    }

    get Q() {
        return this.v > 0 ? this.vs / this.v : 0;
    }

    ucb(totalV) {
        const c_puct = 2.0; // 💡 探索因子，對齊 Python 端
        return this.Q + c_puct * this.p * Math.sqrt(totalV) / (1 + this.v);
    }

    isLeaf() {
        return this.children.size === 0;
    }
}

class Game {
    constructor() {
        console.log("🔥 AI Engine V3 (Bulletproof MCTS + Safe ONNX Parser) Loaded!");
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
        const m = { type: 'flip', pos: [r, c], player: this.turn, name: piece.name };
        this.history.push(m);
        this.logMove(m);

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
            
            const m = { type: 'move', from, to, player: this.turn, piece: piece.name, captured: captured ? captured.name : null };
            this.history.push(m);
            this.logMove(m);
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

        // 動態更新狀態標籤
        if (this.turn === this.playerColor) {
            document.getElementById('ai-status').innerText = `輪到你了 (${this.playerColor === 'red' ? '紅方' : '黑方'})，請進行移動或翻牌`;
        } else if (this.turn === this.aiColor) {
            document.getElementById('ai-status').innerText = `輪到 AI (${this.aiColor === 'red' ? '紅方' : '黑方'}) 思考中...`;
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

        // 通道 16-17: 填入我方/敵方炮的跳吃威脅
        const activeOpp = (turn === 'red') ? 'black' : 'red';
        const teams = [turn, activeOpp];
        for (let i = 0; i < 2; i++) {
            const team = teams[i];
            for (let pr = 0; pr < 4; pr++) {
                for (let pc = 0; pc < 8; pc++) {
                    const p = board[pr][pc];
                    if (p && p.revealed && p.color === team && p.level === 2) { // 炮
                        for (let tr = 0; tr < 4; tr++) {
                            if (this.canMove(board, pr, pc, tr, pc) && board[tr][pc]) {
                                tensor[idx(16 + i, tr, pc)] = 1.0;
                            }
                        }
                        for (let tc = 0; tc < 8; tc++) {
                            if (this.canMove(board, pr, pc, pr, tc) && board[pr][tc]) {
                                tensor[idx(16 + i, pr, tc)] = 1.0;
                            }
                        }
                    }
                }
            }
        }

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
            
            // 🔍 動態尋找長度為 1056 的 policy 輸出 (防止 ONNX 輸出鍵名變更或順序顛倒)
            let policyData = null;
            for (const tensor of Object.values(output)) {
                if (tensor && tensor.data && tensor.data.length === 1056) {
                    policyData = tensor.data;
                    break;
                }
            }
            
            if (!policyData) {
                console.error("ONNX inference: Could not find policy output with length 1056");
                return null;
            }
            
            let maxL = -Infinity;
            for (let i = 0; i < policyData.length; i++) {
                if (policyData[i] > maxL) maxL = policyData[i];
            }
            
            const exps = Array.from(policyData).map(x => Math.exp(x - maxL));
            const sumE = exps.reduce((a, b) => a + b, 0);
            return exps.map(x => x / sumE);
        } catch(e) {
            console.error('ONNX inference error:', e);
            return null;
        }
    }

    getHeuristicScore(move, playerColor) {
        const opponentColor = playerColor === 'red' ? 'black' : 'red';
        if (move.type === 'flip') {
            return 1.5;
        }
        
        const [sr, sc] = move.from;
        const [tr, tc] = move.to;
        const piece = this.board[sr][sc];
        const target = this.board[tr][tc];
        
        let score = 0;
        
        if (target && target.color === opponentColor) {
            score += target.level * 10;
            if (piece.level === 1 && target.level === 7) {
                score += 50;
            }
        }
        
        const tempBoard = JSON.parse(JSON.stringify(this.board));
        tempBoard[tr][tc] = tempBoard[sr][sc];
        tempBoard[sr][sc] = null;
        
        let isDangerous = false;
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 8; c++) {
                const op = tempBoard[r][c];
                if (op && op.revealed && op.color === opponentColor) {
                    if (this.canMove(tempBoard, r, c, tr, tc)) {
                        isDangerous = true;
                        break;
                    }
                }
            }
        }
        
        if (isDangerous) {
            score -= piece.level * 8;
        }
        
        return score;
    }

    getHeuristicValue(board, turn) {
        const pieceVals = {
            1:1000, 2:850, 3:650, 4:450, 5:250, 6:550, 7:150,
            [-1]:-1000, [-2]:-850, [-3]:-650, [-4]:-450, [-5]:-250, [-6]:-550, [-7]:-150,
            0:0, 10:0
        };
        
        let redPawnCount = 0;
        let blackPawnCount = 0;
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 8; c++) {
                const p = board[r][c];
                if (p && p.revealed) {
                    const pv = p.color === 'red' ? (8 - p.level) : -(8 - p.level);
                    if (pv === 7) redPawnCount++;
                    if (pv === -7) blackPawnCount++;
                }
            }
        }
        
        const vals = { ...pieceVals };
        if (blackPawnCount === 0) vals[1] += 500;
        if (redPawnCount === 0) vals[-1] -= 500;
        
        let score = 0;
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 8; c++) {
                const p = board[r][c];
                if (p && p.revealed) {
                    const pv = p.color === 'red' ? (8 - p.level) : -(8 - p.level);
                    const val = vals[pv] || 0;
                    
                    // 💡 檢查是否有任何敵方活子可以直接吃掉我們 (含遠程炮的跳吃威脅)
                    let inDanger = false;
                    for (let er = 0; er < 4; er++) {
                        for (let ec = 0; ec < 8; ec++) {
                            const enemy = board[er][ec];
                            if (enemy && enemy.revealed && enemy.color !== p.color) {
                                if (this.canMove(board, er, ec, r, c)) {
                                    inDanger = true;
                                    break;
                                }
                            }
                        }
                        if (inDanger) break;
                    }
                    
                    if (inDanger) {
                         score += val * 0.3; // 💡 處於相鄰敵方威脅下，價值折扣 70% (避免智障送子)
                    } else {
                         score += val;
                    }
                }
            }
        }
        
        let h = Math.max(Math.min(score / 5000.0, 1.0), -1.0);
        return turn === 'red' ? h : -h;
    }

    async runInferenceWithCustomBoard(board, turn, lastMove) {
        if (!this.session) return null;
        try {
            const tensorData = this.boardToTensor(board, turn, lastMove);
            const inputTensor = new ort.Tensor('float32', tensorData, [1, 34, 4, 8]);
            const output = await this.session.run({ input: inputTensor });
            
            // 🔍 獲取正確對應長度的 policy (1056) 與 value (1) 輸出，完全免疫 key 順序反轉
            let policyData = null;
            let valueData = null;
            for (const tensor of Object.values(output)) {
                if (tensor && tensor.data) {
                    if (tensor.data.length === 1056) {
                        policyData = tensor.data;
                    } else if (tensor.data.length === 1) {
                        valueData = tensor.data;
                    }
                }
            }
            
            if (!policyData || !valueData) {
                console.error("ONNX custom inference: Shape mismatch!");
                return null;
            }
            
            let maxL = -Infinity;
            for (let i = 0; i < policyData.length; i++) {
                if (policyData[i] > maxL) maxL = policyData[i];
            }
            
            const exps = Array.from(policyData).map(x => Math.exp(x - maxL));
            const sumE = exps.reduce((a, b) => a + b, 0);
            const probs = exps.map(x => x / sumE);
            
            const value = valueData[0];
            return { probs, value };
        } catch(e) {
            console.error('ONNX custom board inference error:', e);
            return null;
        }
    }

    getRemainingHiddenPool() {
        const pool = [];
        const counts = {};
        
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
        
        for (const info of piecesInfo) {
            counts[`${info.color}_${info.name}`] = info.count;
        }
        
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                if (p && p.revealed) {
                    counts[`${p.color}_${p.name}`]--;
                }
            }
        }
        
        for (const record of this.history) {
            if (record.captured) {
                const capturerColor = record.player;
                const capturedColor = capturerColor === 'red' ? 'black' : 'red';
                counts[`${capturedColor}_${record.captured}`]--;
            }
        }
        
        for (const key in counts) {
            const parts = key.split('_');
            const color = parts[0];
            const name = parts[1];
            const info = piecesInfo.find(i => i.color === color && i.name === name);
            const level = info.level;
            
            for (let i = 0; i < Math.max(0, counts[key]); i++) {
                pool.push({ name, level, color, revealed: false });
            }
        }
        
        return pool;
    }

    async runMCTS(simulations = 800) {
        if (!this.session) return null;
        
        const { normal: moves } = this.getValidMoves(this.aiColor);
        if (moves.length === 0) return null;
        
        const root = new MCTSNode(1.0);
        const rawProbs = await this.runInference(this.board, this.aiColor, this.lastMove);
        if (!rawProbs) return null;
        
        let sumP = 0;
        const validProbs = moves.map(m => {
            const aid = this.actionToId(m);
            const p = rawProbs[aid] || 0;
            sumP += p;
            return p;
        });
        
        for (let i = 0; i < moves.length; i++) {
            const m = moves[i];
            const aid = this.actionToId(m);
            // 💡 MCTS 先驗機率平滑 (Prior Smoothing)：給予合法移動 10% 基礎均勻機率，防範炮打被餓死
            const rawPrior = sumP > 0 ? validProbs[i] / sumP : 1.0 / moves.length;
            const prior = 0.9 * rawPrior + 0.1 / moves.length;
            root.children.set(aid, new MCTSNode(prior, root, m));
        }
        
        for (let sim = 0; sim < simulations; sim++) {
            try {
                let sb = JSON.parse(JSON.stringify(this.board));
                let ct = this.aiColor;
                let sd = [];
                
                let path = [root];
                let curr = root;
                let pool = this.getRemainingHiddenPool();
                
                while (!curr.isLeaf()) {
                    let bestAid = null;
                    let bestUcb = -Infinity;
                    
                    for (const [aid, child] of curr.children) {
                        const u = child.ucb(root.v);
                        if (u > bestUcb) {
                            bestUcb = u;
                            bestAid = aid;
                        }
                    }
                    
                    if (bestAid === null) break;
                    curr = curr.children.get(bestAid);
                    path.push(curr);
                    
                    const m = curr.move;
                    if (m.type === 'flip') {
                        const [r, c] = m.pos;
                        if (pool && pool.length > 0) {
                            const idx = Math.floor(Math.random() * pool.length);
                            const p = pool.splice(idx, 1)[0];
                            if (p) {
                                sb[r][c] = { ...p, revealed: true };
                            } else {
                                sb[r][c] = { name: '兵', level: 1, color: 'red', revealed: true };
                            }
                        } else {
                            sb[r][c] = { name: '兵', level: 1, color: 'red', revealed: true }; // 🛡️ 剩餘暗子空時的防崩潰回退
                        }
                        // 💡 修正隨機節點 MCTS 穿透 Bug：隨機翻牌後盤面變更，必須立即 break 作為葉子評估，防止隨機樹不匹配
                        break;
                    } else {
                        const [sr, sc] = m.from;
                        const [tr, tc] = m.to;
                        const target = sb[tr][tc];
                        if (target) sd.push(target);
                        sb[tr][tc] = sb[sr][sc];
                        sb[sr][sc] = null;
                    }
                    
                    ct = ct === 'red' ? 'black' : 'red';
                }
                
                let val = 0.0;
                const { normal: leafMoves } = this.getValidMoves(ct, sb);
                
                if (leafMoves.length === 0) {
                    val = -1.0; 
                } else {
                    const output = await this.runInferenceWithCustomBoard(sb, ct, curr.move);
                    if (output) {
                        const { probs: p_c, value: nv } = output;
                        let hiddenCount = 0;
                        for (let r = 0; r < 4; r++) {
                            for (let c = 0; c < 8; c++) {
                                const p = sb[r][c];
                                if (p && !p.revealed) hiddenCount++;
                            }
                        }
                        const bf = 0.2 + 0.5 * (1.0 - (hiddenCount / 32.0));
                        val = (1.0 - bf) * nv + bf * this.getHeuristicValue(sb, ct);
                        
                        let sumLeafP = 0;
                        const leafProbs = leafMoves.map(m => {
                            const aid = this.actionToId(m);
                            const p = p_c[aid] || 0;
                            sumLeafP += p;
                            return p;
                        });
                        
                        for (let i = 0; i < leafMoves.length; i++) {
                            const m = leafMoves[i];
                            const aid = this.actionToId(m);
                            // 💡 葉子擴充先驗機率平滑 (Prior Smoothing)：給予合法移動 10% 基礎均勻機率
                            const rawPrior = sumLeafP > 0 ? leafProbs[i] / sumLeafP : 1.0 / leafMoves.length;
                            const prior = 0.9 * rawPrior + 0.1 / leafMoves.length;
                            curr.children.set(aid, new MCTSNode(prior, curr, m));
                        }
                    }
                }
                
                let cv = -val;
                for (let i = path.length - 1; i >= 1; i--) {
                    const node = path[i];
                    node.v += 1;
                    node.vs += cv;
                    cv = -cv;
                }
                root.v += 1;
            } catch(simError) {
                console.error("MCTS single simulation error (safely caught):", simError);
                break; // 🛡️ 安全中斷此輪模擬，防止整盤遊戲卡死
            }
        }
        
        let bestAid = null;
        let maxV = -1;
        for (const [aid, child] of root.children) {
            if (child.v > maxV) {
                maxV = child.v;
                bestAid = aid;
            }
        }
        
        return bestAid !== null ? root.children.get(bestAid).move : null;
    }

    async aiMove() {
        this.updateStatus('AI 正在思考 (MCTS 搜尋中)...');
        await new Promise(r => setTimeout(r, 600));

        const { normal: moves, repMoves } = this.getValidMoves(this.aiColor);
        
        if (moves.length === 0) {
            if (repMoves.length > 0) this.endGame('draw', '只剩禁手步');
            else this.endGame(this.playerColor, '無棋可走');
            return;
        }

        // 💡 執行強大的蒙地卡羅樹搜尋 (MCTS)，對齊 Python 世界冠軍級算力，並附加頂級異常隔離
        let chosenMove = null;
        try {
            chosenMove = await this.runMCTS(800);
        } catch(mctsError) {
            console.error("MCTS execution crashed! Falling back safely...", mctsError);
        }
        
        // 🛡️ 雙重保險降級機制：若 MCTS 未能回傳 (例如 ONNX 異常)，降級使用直覺+戰術避險引擎
        if (!chosenMove) {
            console.log("MCTS Fallback to Heuristic engine");
            const probs = await this.runInference(this.board, this.aiColor, this.lastMove);
            if (probs) {
                let bestScore = -9999;
                for (const move of moves) {
                    const aid = this.actionToId(move);
                    const policyProb = probs[aid] || 0;
                    const heuristic = this.getHeuristicScore(move, this.aiColor);
                    const totalScore = policyProb * 15.0 + heuristic;
                    if (totalScore > bestScore) {
                        bestScore = totalScore;
                        chosenMove = move;
                    }
                }
            } else {
                chosenMove = moves[Math.floor(Math.random() * moves.length)];
            }
        }

        // 執行走步
        if (chosenMove.type === 'flip') {
            const piece = this.board[chosenMove.pos[0]][chosenMove.pos[1]];
            piece.revealed = true;
            this.historyHashes.clear(); // 💡 翻牌清空歷史
            const m = { ...chosenMove, name: piece.name };
            this.history.push(m);
            this.logMove(m);
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
            const m = { ...chosenMove, piece: piece.name, captured: captured?.name ?? null };
            this.history.push(m);
            this.logMove(m);
            this.lastMove = chosenMove;
        }

        this.render();
        this.nextTurn();
    }

    getValidMoves(player, board = this.board) {
        let normal = [], repMoves = [];
        const nextTurn = (player === 'red' ? 'black' : 'red');

        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 8; c++) {
                const p = board[r][c];
                if (!p) continue;
                if (!p.revealed) {
                    normal.push({ type: 'flip', pos: [r, c], player });
                } else if (p.color === player) {
                    const candidates = [];
                    const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
                    for (let [dr, dc] of dirs) {
                        let tr = r + dr, tc = c + dc;
                        if (tr >= 0 && tr < 4 && tc >= 0 && tc < 8 && this.canMove(board, r, c, tr, tc)) {
                            candidates.push({ type: 'move', from: [r, c], to: [tr, tc], player });
                        }
                    }
                    if (p.level === 2) { 
                        for (let tr = 0; tr < 4; tr++) if (this.canMove(board, r, c, tr, c)) candidates.push({ type: 'move', from: [r, c], to: [tr, c], player });
                        for (let tc = 0; tc < 8; tc++) if (this.canMove(board, r, c, r, tc)) candidates.push({ type: 'move', from: [r, c], to: [r, tc], player });
                    }

                    // 💡 檢查禁手規則
                    for (let m of candidates) {
                        const tempB = JSON.parse(JSON.stringify(board));
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

    logMove(move) {
        const playerStr = move.player === this.playerColor ? '你' : 'AI';
        const colorStr = move.player === 'red' ? '紅方' : '黑方';
        if (move.type === 'flip') {
            this.log(`${playerStr}(${colorStr}) 翻開了 [${move.name}]`);
        } else {
            const pieceName = move.piece;
            if (move.captured) {
                this.log(`${playerStr}(${colorStr}) 移動 [${pieceName}] 吃掉了 [${move.captured}]`);
            } else {
                this.log(`${playerStr}(${colorStr}) 移動了 [${pieceName}]`);
            }
        }
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
