// ==================== Canvas 渲染器 (宽轨道 + 倒计时 + 完整皮肤) ====================

class Renderer {
    constructor(canvas, ctx) {
        this.canvas = canvas;
        this.ctx = ctx;
        this.canvasWidth = 0;
        this.canvasHeight = 0;
        this.trackStartX = 0;
        this.resize();
    }

    resize() {
        this.canvasWidth = window.innerWidth;
        this.canvasHeight = window.innerHeight;
        this.canvas.width = this.canvasWidth;
        this.canvas.height = this.canvasHeight;

        const totalTrackWidth = CONFIG.trackCount * CONFIG.trackWidth + (CONFIG.trackCount - 1) * CONFIG.trackSpacing;
        this.trackStartX = (this.canvasWidth - totalTrackWidth) / 2;
        this.ctx.imageSmoothingEnabled = true;
    }

    drawBackground(time) {
        const ctx = this.ctx;
        const grad = ctx.createLinearGradient(0, 0, 0, this.canvasHeight);
        grad.addColorStop(0, '#0f0f18');
        grad.addColorStop(1, '#1a1a28');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
    }

    drawTracks() {
        const ctx = this.ctx;
        const judgmentY = this.canvasHeight * CONFIG.judgmentLineY;

        for (let i = 0; i < CONFIG.trackCount; i++) {
            const x = this.trackStartX + i * (CONFIG.trackWidth + CONFIG.trackSpacing);

            // 轨道虚线
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 12]);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.canvasHeight);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // 判定线
        const totalWidth = CONFIG.trackWidth * CONFIG.trackCount + CONFIG.trackSpacing * (CONFIG.trackCount - 1);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fillRect(this.trackStartX - 10, judgmentY - 1, totalWidth + 20, 2);
    }

    drawNotes(currentTime) {
        const judgmentY = this.canvasHeight * CONFIG.judgmentLineY;
        const speedMultiplier = noteSpeed * 100;

        for (let i = 0; i < gameState.notes.length; i++) {
            const note = gameState.notes[i];
            // 跳过已完成的 tap；hold 即使 head 已命中仍继续渲染（只要 holdActive 为 true）
            if (note.hit && note.type !== 'hold') continue;
            if (note.type === 'hold' && note.hit && !note.holdActive) continue;

            const timeDiff = note.time - currentTime;
            const y = judgmentY - (timeDiff / 1000) * speedMultiplier;

            // Hold 长条特殊处理
            if (note.type === 'hold' && note.endTime) {
                const endTimeDiff = note.endTime - currentTime;
                const yEnd = judgmentY - (endTimeDiff / 1000) * speedMultiplier;

                // Hold 头部已过屏幕底部且未命中 → Miss
                if (y > this.canvasHeight + 100 && !note.hit) {
                    if (!note.missed) {
                        note.missed = true;
                        note.hit = true;
                        gameState.activeHolds[note.track] = null;
                        gameState.miss++;
                        gameState.intervalStats.miss++;
                        gameState.combo = 0;
                        gameState.health = Math.max(0, gameState.health - 10);
                        this.createMissEffect(judgmentY, note.track);
                        audioEngine.playHitSound('miss');
                    }
                    continue;
                }

                // Hold 尾部已过屏幕底部 → 清理
                if (yEnd > this.canvasHeight + 100) {
                    continue;
                }

                // Hold 完全在上方 → 不渲染
                if (yEnd < -50 && y < -50) continue;

                note.y = y;
                const x = this.trackStartX + note.track * (CONFIG.trackWidth + CONFIG.trackSpacing);

                // 裁剪可见区域：top = 较上方的点, bottom = 较下方的点
                const yTop = Math.min(y, yEnd);
                const yBottom = Math.max(y, yEnd);
                const visibleYTop = Math.max(yTop, -50);
                const visibleYBottom = Math.min(yBottom, this.canvasHeight);

                this.drawHoldBody(x, visibleYTop, visibleYBottom, TRACK_COLORS[note.track], note.holdActive);
                continue;
            }

            // === Tap 音符 ===
            // Miss 判定
            if (y > this.canvasHeight + 100) {
                if (!note.missed) {
                    note.missed = true;
                    gameState.miss++;
                    gameState.intervalStats.miss++;
                    gameState.combo = 0;
                    gameState.health = Math.max(0, gameState.health - 10);
                    this.createMissEffect(judgmentY, note.track);
                    audioEngine.playHitSound('miss');
                }
                continue;
            }
            if (y < -50) continue;

            note.y = y;
            const x = this.trackStartX + note.track * (CONFIG.trackWidth + CONFIG.trackSpacing);
            this.drawNoteByStyle(x, y, TRACK_COLORS[note.track], noteStyle);
        }
    }

    /**
     * 绘制 Hold 长条身体
     * @param {number} x - 轨道起始 X
     * @param {number} yTop - 上端 Y（较小值）
     * @param {number} yBottom - 下端 Y（较大值）
     * @param {string} color - 颜色
     * @param {boolean} isActive - 是否正在被按住
     */
    drawHoldBody(x, yTop, yBottom, color, isActive) {
        const ctx = this.ctx;
        const trackW = CONFIG.trackWidth;
        const bodyW = trackW - 8;
        const bodyX = x + 4;
        const headH = 24;
        const tailH = 16;

        // yTop = 尾部（上端），yBottom = 头部（下端，靠近判定线）
        // 身体在尾部装饰和头部 note 之间
        const bodyTop = yTop + tailH;
        const bodyEnd = yBottom;
        const bodyHeight = bodyEnd - bodyTop;
        const alpha = isActive ? 0.6 : 0.35;

        // 半透明长条身体
        if (bodyHeight > 0) {
            ctx.globalAlpha = alpha;
            ctx.fillStyle = color;
            ctx.fillRect(bodyX, bodyTop, bodyW, bodyHeight);

            // 两侧边缘高光
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.fillRect(bodyX, bodyTop, 3, bodyHeight);
            ctx.fillRect(bodyX + bodyW - 3, bodyTop, 3, bodyHeight);

            ctx.globalAlpha = 1.0;
        }

        // 头部判定 — 渲染为对应的 note 皮肤（位于 yBottom，靠近判定线）
        if (yBottom > -50 && yBottom < this.canvasHeight) {
            this.drawNoteByStyle(x, yBottom, color, noteStyle);
        }

        // 尾部装饰（位于 yTop，远离判定线）
        if (yTop > -50 && yTop < this.canvasHeight) {
            ctx.globalAlpha = alpha * 0.8;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.roundRect(bodyX, yTop, bodyW, tailH, 4);
            ctx.fill();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.fillRect(bodyX, yTop + tailH - 3, bodyW, 3);
            ctx.globalAlpha = 1.0;
        }
    }

    /**
     * 根据皮肤类型绘制音符
     * @param {number} x 音符 X 坐标
     * @param {number} y 音符 Y 坐标
     * @param {string} color 音符颜色
     * @param {'pixel'|'orb'} style 皮肤类型
     */
    drawNoteByStyle(x, y, color, style) {
        const ctx = this.ctx;
        const w = CONFIG.trackWidth - 4;
        const h = 24;

        if (style === 'orb') {
            // 纯色圆皮：扁平实心圆 Note，直径略小于轨道宽度
            const cx = x + CONFIG.trackWidth / 2;               // 圆心 X（轨道中心）
            const cy = y + h / 2;                                // 圆心 Y
            const radius = CONFIG.trackWidth * 0.475;            // 直径 = 轨道宽 × 0.95

            // 主体纯色圆形（无阴影、无渐变，纯平面风格）
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // 砖皮：圆角矩形带顶部高光
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.roundRect(x + 2, y, w, h, 6);
            ctx.fill();
            // 顶部高光条
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.fillRect(x + 2, y, w, 3);
        }
    }

    drawCountdown(secondsLeft) {
        if (secondsLeft <= 0) return;
        const ctx = this.ctx;
        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2 - 30;

        // 半透明背景
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.beginPath();
        ctx.arc(centerX, centerY, 55, 0, Math.PI * 2);
        ctx.fill();

        // 倒计时数字
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 52px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const display = Math.ceil(secondsLeft);
        ctx.fillText(display.toString(), centerX, centerY + 2);

        // 圆环进度
        ctx.strokeStyle = '#4dabf7';
        ctx.lineWidth = 4;
        ctx.beginPath();
        const progress = 1 - (secondsLeft / (CONFIG.countdownDuration / 1000));
        ctx.arc(centerX, centerY, 50, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
        ctx.stroke();
    }

    drawLasers() {
        for (let i = gameState.lasers.length - 1; i >= 0; i--) {
            const laser = gameState.lasers[i];
            laser.height += 15;
            laser.alpha -= 0.05;
            if (laser.alpha <= 0) { gameState.lasers.splice(i, 1); continue; }
            this.ctx.globalAlpha = laser.alpha * 0.4;
            this.ctx.fillStyle = laser.color;
            const startY = this.canvasHeight * CONFIG.judgmentLineY;
            this.ctx.fillRect(laser.x - 2, startY - laser.height, 4, laser.height);
        }
        this.ctx.globalAlpha = 1.0;
    }

    drawParticles() {
        for (let i = gameState.particles.length - 1; i >= 0; i--) {
            const p = gameState.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.05;
            if (p.life <= 0) { gameState.particles.splice(i, 1); continue; }
            this.ctx.globalAlpha = p.life * 0.6;
            this.ctx.fillStyle = p.color;
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
            this.ctx.fill();
        }
        this.ctx.globalAlpha = 1.0;
    }

    drawJudgments() {
        const ctx = this.ctx;
        for (let i = gameState.judgments.length - 1; i >= 0; i--) {
            const j = gameState.judgments[i];
            j.y -= 1.5;
            j.alpha -= 0.02;
            if (j.bounce > 1.0) j.bounce -= 0.05;
            if (j.alpha <= 0) { gameState.judgments.splice(i, 1); continue; }

            const x = this.trackStartX + j.track * (CONFIG.trackWidth + CONFIG.trackSpacing) + CONFIG.trackWidth / 2;
            ctx.globalAlpha = j.alpha;
            ctx.font = `bold ${Math.round(14 * j.bounce)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            if (j.text === 'PERFECT') ctx.fillStyle = '#ffd43b';
            else if (j.text === 'GREAT') ctx.fillStyle = '#69db7c';
            else ctx.fillStyle = '#ff6b6b';

            ctx.fillText(j.text, x, j.y);
        }
        ctx.globalAlpha = 1.0;
    }

    drawHUD() {
        const ctx = this.ctx;
        ctx.save();

        // 分数
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('SCORE', 30, 30);
        ctx.font = 'bold 28px sans-serif';
        ctx.fillStyle = '#4dabf7';
        ctx.fillText(gameState.score.toLocaleString(), 30, 55);

        // 血条
        const hX = this.canvasWidth - 180;
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.beginPath();
        ctx.roundRect(hX, 25, 140, 14, 7);
        ctx.fill();
        const healthColor = gameState.health > 60 ? '#69db7c' : gameState.health > 30 ? '#ffd43b' : '#ff6b6b';
        ctx.fillStyle = healthColor;
        ctx.beginPath();
        ctx.roundRect(hX, 25, Math.max(0, 140 * gameState.health / 100), 14, 7);
        ctx.fill();

        // 连击
        if (gameState.combo > 0) {
            ctx.font = 'bold 36px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(gameState.combo, this.canvasWidth / 2, this.canvasHeight / 2 - 10);
            ctx.font = '12px sans-serif';
            ctx.fillStyle = '#aaaaaa';
            ctx.fillText('COMBO', this.canvasWidth / 2, this.canvasHeight / 2 + 22);
        }

        // 统计数据
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffd43b';
        ctx.fillText('P:' + gameState.perfect, 30, 100);
        ctx.fillStyle = '#69db7c';
        ctx.fillText('G:' + gameState.great, 130, 100);
        ctx.fillStyle = '#ff6b6b';
        ctx.fillText('M:' + gameState.miss, 230, 100);

        const acc = gameState.calculateTotalAcc();
        ctx.fillStyle = '#ffffff';
        ctx.fillText('ACC:' + acc.toFixed(2) + '%', 30, 125);

        ctx.restore();
    }

    drawLineChart(historyData) {
        const chartCanvas = document.getElementById('lineChartCanvas');
        if (!chartCanvas) return;
        const cCtx = chartCanvas.getContext('2d');
        const container = chartCanvas.parentElement;
        if (!container) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        chartCanvas.width = w;
        chartCanvas.height = h;
        cCtx.clearRect(0, 0, w, h);

        if (historyData.length === 0) return;
        const leftMargin = 40, topMargin = 20, bottomMargin = 20, rightMargin = 10;
        const chartW = w - leftMargin - rightMargin;
        const chartH = h - topMargin - bottomMargin;

        cCtx.fillStyle = 'rgba(255,255,255,0.05)';
        cCtx.fillRect(0, 0, w, h);

        // 计算数据的最小值和最大值
        let minAcc = 100, maxAcc = 0;
        historyData.forEach(data => {
            minAcc = Math.min(minAcc, data.totalAcc);
            maxAcc = Math.max(maxAcc, data.totalAcc);
        });

        // 确保最小值不会是0（避免完全空的图表）
        if (minAcc === maxAcc) {
            minAcc = Math.max(0, minAcc - 10);
            maxAcc = Math.min(100, maxAcc + 10);
        }

        // 添加一些padding（上下各10%）
        const range = maxAcc - minAcc;
        const padding = range * 0.1;
        const yMin = Math.max(0, minAcc - padding);
        const yMax = Math.min(100, maxAcc + padding);
        const yRange = yMax - yMin;

        // 绘制Y轴标签（自适应生成3-4个标记）
        cCtx.fillStyle = 'rgba(255,255,255,0.5)';
        cCtx.font = '10px sans-serif';
        cCtx.textAlign = 'right';

        // 生成合理的Y轴刻度
        const yTicks = this.generateYTicks(yMin, yMax);
        yTicks.forEach(tick => {
            const yPos = topMargin + chartH - (chartH * (tick - yMin) / yRange);
            cCtx.fillText(tick.toFixed(0) + '%', leftMargin - 4, yPos + 4);
        });

        // 绘制网格线
        cCtx.strokeStyle = 'rgba(255,255,255,0.1)';
        cCtx.lineWidth = 1;
        yTicks.forEach(tick => {
            const yPos = topMargin + chartH - (chartH * (tick - yMin) / yRange);
            cCtx.beginPath();
            cCtx.moveTo(leftMargin, yPos);
            cCtx.lineTo(leftMargin + chartW, yPos);
            cCtx.stroke();
        });

        // 绘制曲线
        const pointSpacing = historyData.length > 1 ? chartW / (historyData.length - 1) : 0;
        cCtx.strokeStyle = '#4dabf7';
        cCtx.lineWidth = 2;
        cCtx.beginPath();
        historyData.forEach((data, index) => {
            const x = leftMargin + index * pointSpacing;
            const normalizedAcc = (data.totalAcc - yMin) / yRange;
            const y = topMargin + chartH - (chartH * normalizedAcc);
            if (index === 0) cCtx.moveTo(x, y);
            else cCtx.lineTo(x, y);
        });
        cCtx.stroke();

        // 绘制数据点
        cCtx.fillStyle = '#4dabf7';
        historyData.forEach((data, index) => {
            const x = leftMargin + index * pointSpacing;
            const normalizedAcc = (data.totalAcc - yMin) / yRange;
            const y = topMargin + chartH - (chartH * normalizedAcc);
            cCtx.beginPath();
            cCtx.arc(x, y, 3, 0, Math.PI * 2);
            cCtx.fill();
        });
    }

    // 生成合理的Y轴刻度
    generateYTicks(min, max) {
        const range = max - min;
        let interval = 10;

        if (range <= 10) interval = 2;
        else if (range <= 20) interval = 5;
        else if (range <= 50) interval = 10;
        else if (range <= 100) interval = 20;

        const ticks = [];
        const start = Math.ceil(min / interval) * interval;
        const end = Math.floor(max / interval) * interval;

        for (let i = start; i <= end; i += interval) {
            if (i >= min && i <= max) {
                ticks.push(i);
            }
        }

        // 确保至少有3个刻度
        if (ticks.length < 3) {
            ticks.push(min);
            ticks.push(max);
            ticks.sort((a, b) => a - b);
        }

        return [...new Set(ticks)]; // 去重
    }

    createMissEffect(y, track) {
        gameState.judgments.push({ text: 'MISS', y: y - 40, track, alpha: 1, scale: 1.0, bounce: 1.0 });
    }

    addJudgment(text, y, track) {
        gameState.judgments.push({ text, y: y - 40, track, alpha: 1, scale: 1.0, bounce: 1.2 });
    }

    createHitParticles(y, track, color) {
        const x = this.trackStartX + track * (CONFIG.trackWidth + CONFIG.trackSpacing) + CONFIG.trackWidth / 2;
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI * 2 * i) / 6;
            gameState.particles.push({
                x, y,
                vx: Math.cos(angle) * 4,
                vy: Math.sin(angle) * 4,
                size: 8,
                color,
                life: 1.0
            });
        }
    }

    createLaser(track) {
        const x = this.trackStartX + track * (CONFIG.trackWidth + CONFIG.trackSpacing) + CONFIG.trackWidth / 2;
        gameState.lasers.push({ x, width: 4, height: 0, color: TRACK_COLORS[track], alpha: 0.8 });
    }
}

// roundRect polyfill
if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
        if (typeof r === 'number') r = { tl: r, tr: r, br: r, bl: r };
        this.beginPath();
        this.moveTo(x + r.tl, y);
        this.lineTo(x + w - r.tr, y);
        this.quadraticCurveTo(x + w, y, x + w, y + r.tr);
        this.lineTo(x + w, y + h - r.br);
        this.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
        this.lineTo(x + r.bl, y + h);
        this.quadraticCurveTo(x, y + h, x, y + h - r.bl);
        this.lineTo(x, y + r.tl);
        this.quadraticCurveTo(x, y, x + r.tl, y);
        this.closePath();
        return this;
    };
}