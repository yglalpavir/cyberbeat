// ==================== Canvas 渲染器 (性能优化版) ====================

class Renderer {
    constructor(canvas, ctx) {
        this.canvas = canvas;
        this.ctx = ctx;
        this.canvasWidth = 0;
        this.canvasHeight = 0;
        this.trackStartX = 0;
        this._dpr = 1;
        this._hudScale = 1;
        this._safeTop = 0;
        this._safeRight = 0;
        this._safeBottom = 0;
        this._safeLeft = 0;
        this._controlsHeight = 0;

        // 预计算轨道坐标
        this.trackPositions = [];   // [{x, cx, hitX, hitW}]

        // 缓存背景
        this._bgGradient = null;
        this._bgCacheWidth = 0;
        this._bgCacheHeight = 0;

        // delta-time（毫秒），默认 60fps
        this._dt = 16.67;

        // 对象池 - 粒子
        this._particlePool = [];
        this._particlePoolIdx = 0;
        this._PARTICLE_POOL_MAX = 256;
        // 对象池 - 判定文字
        this._judgmentPool = [];
        this._judgmentPoolIdx = 0;
        this._JUDGMENT_POOL_MAX = 64;
        // 对象池 - 激光
        this._laserPool = [];
        this._laserPoolIdx = 0;
        this._LASER_POOL_MAX = 64;
        // 触控点显示（移动端）：按住中的圆环 + 松开后的涟漪
        // touch 对象: {x, y, track, phase: 'down'|'ripple', age}
        this._touchPoints = new Map();   // key: pointerId/touch identifier
        this._touchRipples = [];         // 松开后的扩散涟漪（短生命周期）

        this.resize();
    }

    /** 设置帧间隔（毫秒），用于 delta-time 缩放视觉效果 */
    setFrameDelta(dt) {
        // 钳制到 8~50ms（20~120fps 等效），防止极值
        this._dt = dt < 8 ? 8 : (dt > 50 ? 50 : dt);
    }

    resize() {
        this.canvasWidth = window.innerWidth;
        this.canvasHeight = window.innerHeight;

        // 读取安全区（刘海屏 / 手势条），由 CSS 自定义属性提供
        const rootStyle = getComputedStyle(document.documentElement);
        const readPx = (name) => {
            const v = parseFloat(rootStyle.getPropertyValue(name));
            return Number.isFinite(v) ? v : 0;
        };
        this._safeTop = readPx('--safe-top');
        this._safeRight = readPx('--safe-right');
        this._safeBottom = readPx('--safe-bottom');
        this._safeLeft = readPx('--safe-left');

        // 高 DPI 屏幕按 devicePixelRatio 渲染：
        // 桌面上限 2；触屏设备限 1.5（旗艖手机 3x DPR 全渲染易掉帧），
        // 小屏/低端机（内存较小）进一步降为 1.25
        const rawDpr = window.devicePixelRatio || 1;
        let dprCap = 2;
        if (IS_TOUCH_DEVICE) {
            dprCap = this.canvasWidth * rawDpr > 1600 ? 1.5 : 1.75;
        }
        const dpr = Math.min(rawDpr, dprCap);
        this._dpr = dpr;
        this.canvas.width = Math.round(this.canvasWidth * dpr);
        this.canvas.height = Math.round(this.canvasHeight * dpr);
        this.canvas.style.width = this.canvasWidth + 'px';
        this.canvas.style.height = this.canvasHeight + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // 窄屏自适应轨道宽度：320px 也能完整放下 4 轨
        const gap = this.canvasWidth < 480 ? 8 : 12;
        const sidePadding = this.canvasWidth < 480 ? 20 : 32;
        const availableWidth = this.canvasWidth - sidePadding;
        const fittedWidth = Math.floor((availableWidth - gap * (CONFIG.trackCount - 1)) / CONFIG.trackCount);
        CONFIG.trackWidth = Math.max(44, Math.min(80, fittedWidth));
        CONFIG.trackSpacing = gap;

        const totalTrackWidth = CONFIG.trackCount * CONFIG.trackWidth + (CONFIG.trackCount - 1) * CONFIG.trackSpacing;
        this.trackStartX = (this.canvasWidth - totalTrackWidth) / 2;

        // 预计算轨道坐标
        this.trackPositions.length = 0;
        for (let i = 0; i < CONFIG.trackCount; i++) {
            const x = this.trackStartX + i * (CONFIG.trackWidth + CONFIG.trackSpacing);
            this.trackPositions.push({
                x: x,
                cx: x + CONFIG.trackWidth / 2,
                hitX: x + 2,
                hitW: CONFIG.trackWidth - 4
            });
        }

        // 判定线：为底部触控键和安全区留出空间，避免音符被手指/手势条遮挡
        this._controlsHeight = IS_TOUCH_DEVICE ? (this.canvasHeight <= 520 ? 68 : 92) : 0;
        const reservedBottom = this._controlsHeight + this._safeBottom + 12;
        const availableHeight = Math.max(180, this.canvasHeight - reservedBottom);
        const desiredY = this.canvasHeight * CONFIG.judgmentLineY;
        const maxY = Math.max(120, availableHeight - 18);
        this._judgmentY = Math.min(Math.max(availableHeight * 0.62, Math.min(desiredY, maxY)), this.canvasHeight - 40);

        // HUD 缩放（小屏使用较小字号，但不低于可读下限）
        this._hudScale = Math.max(0.78, Math.min(1, Math.min(this.canvasWidth, this.canvasHeight) / 480));

        // 触屏窄屏：HUD 左上 P/G/M 三列在 100*s 间距下会超出 320px 宽度，压缩间距
        this._hudCompact = this.canvasWidth < 380 && IS_TOUCH_DEVICE;

        // 触屏设备右上角有暂停按钮，血条左移避让
        this._hudRightInset = IS_TOUCH_DEVICE ? 58 : 0;

        // 触屏设备减半打击粒子，降低绘制压力（特效密度对玩法无影响）
        if (IS_TOUCH_DEVICE) {
            CONFIG.effects.particleCount = 5;
        }

        // 清除缓存
        this._bgGradient = null;

        this.ctx.imageSmoothingEnabled = false;
    }

    // ========== 背景 (缓存渐变) ==========
    drawBackground(time) {
        const ctx = this.ctx;

        if (!this._bgGradient || this._bgCacheWidth !== this.canvasWidth || this._bgCacheHeight !== this.canvasHeight) {
            this._bgGradient = ctx.createLinearGradient(0, 0, 0, this.canvasHeight);
            this._bgGradient.addColorStop(0, '#0f0f18');
            this._bgGradient.addColorStop(1, '#1a1a28');
            this._bgCacheWidth = this.canvasWidth;
            this._bgCacheHeight = this.canvasHeight;
        }

        ctx.fillStyle = this._bgGradient;
        ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
    }

    // ========== 轨道 (批量绘制) ==========
    drawTracks() {
        const ctx = this.ctx;
        const positions = this.trackPositions;

        // 所有虚线一次绘制
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 12]);
        ctx.beginPath();
        for (let i = 0; i < positions.length; i++) {
            ctx.moveTo(positions[i].x, 0);
            ctx.lineTo(positions[i].x, this.canvasHeight);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // 判定线
        const totalWidth = CONFIG.trackWidth * CONFIG.trackCount + CONFIG.trackSpacing * (CONFIG.trackCount - 1);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fillRect(this.trackStartX - 10, this._judgmentY - 1, totalWidth + 20, 2);
    }

    // ========== 音符绘制 (可见性裁剪 + 精确几何提前终止) ==========
    drawNotes(currentTime) {
        const notes = gameState.notes;
        const noteCount = notes.length;
        if (noteCount === 0) { perfMonitor.visibleNotes = 0; perfMonitor.totalNotes = 0; return; }

        const positions = this.trackPositions;
        const canvasH = this.canvasHeight;
        const judgmentY = this._judgmentY;
        const speedMul = noteSpeed * 100;
        const colors = TRACK_COLORS;
        const activeHolds = gameState.activeHolds;
        const lossOnMiss = CONFIG.health.lossOnMiss;

        // 二分查找第一个在屏幕底部附近的音符（用于 miss 检测）
        const maxTimeBehind = ((canvasH + 200) / speedMul) * 1000;
        const minVisibleTime = currentTime - maxTimeBehind;
        let startIdx = 0;
        {
            let lo = 0, hi = noteCount - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (notes[mid].time < minVisibleTime) lo = mid + 1;
                else hi = mid;
            }
            startIdx = lo > 5 ? lo - 5 : 0;
        }

        // 精确退出阈值：
        // 音符在屏幕上方时 rawY < -50，即 note.time > currentTime + (judgmentY+50)*1000/speedMul
        // 对 hold 还需加上其持续时间（尾部需可见），取 5 秒安全上限
        const aboveScreenTime = currentTime + (judgmentY + 50) * 1000 / speedMul;
        const safeExitTime = aboveScreenTime + 5000;

        // 轻量退出阈值（仅限 tap）：连续 60 个 tap 都在上方即可安全退出
        // 因为此后的 hold tail 也必定在上方（time 差已远超 safeExitTime 覆盖范围）
        let tapAboveStreak = 0;

        let visibleCount = 0;

        for (let i = startIdx; i < noteCount; i++) {
            const note = notes[i];

            // === 安全退出 ===
            if (note.time > safeExitTime) break;

            // tap 在上方过多 → 轻量退出（hold 早已被 safeExitTime 覆盖）
            if (note.type !== 'hold' && tapAboveStreak > 60 && note.time > aboveScreenTime) {
                break;
            }

            // 跳过已完成的 tap
            if (note.hit && note.type !== 'hold') continue;
            // 跳过已完成且不活跃的 hold
            if (note.type === 'hold' && note.hit && !note.holdActive) continue;

            const timeDiff = note.time - currentTime;
            const rawY = judgmentY - (timeDiff / 1000) * speedMul;

            // === Hold 长条 ===
            if (note.type === 'hold' && note.endTime) {
                tapAboveStreak = 0;
                const endTimeDiff = note.endTime - currentTime;
                const yEnd = judgmentY - (endTimeDiff / 1000) * speedMul;

                // Miss: 头部已过屏幕底部且未命中
                if (rawY > canvasH + 100 && !note.hit) {
                    if (!note.missed) {
                        note.missed = true;
                        note.hit = true;
                        note.holdActive = false;
                        activeHolds[note.track] = null;
                        gameState.miss++;
                        gameState.intervalStats.miss++;
                        gameState.combo = 0;
                        gameState.health = Math.max(0, gameState.health - lossOnMiss);
                        this._addMissEffect(note.track);
                        audioEngine.playHitSound('miss');
                    }
                    continue;
                }
                if (yEnd > canvasH + 100) continue;
                if (yEnd < -50 && rawY < -50) continue;

                note.y = rawY;
                const pos = positions[note.track];
                const yTop = rawY < yEnd ? rawY : yEnd;
                const yBottom = rawY > yEnd ? rawY : yEnd;
                const visYTop = yTop > -50 ? yTop : -50;
                const visYBot = yBottom < canvasH ? yBottom : canvasH;

                this._drawHoldBody(pos.x, visYTop, visYBot, colors[note.track], note.holdActive);
                visibleCount++;
                continue;
            }

            // === Tap 音符 ===
            // 在上方 → 累计 streak
            if (rawY < -50) {
                tapAboveStreak++;
                continue;
            }
            tapAboveStreak = 0;

            // 已过底部 → Miss
            if (rawY > canvasH + 100) {
                if (!note.missed) {
                    note.missed = true;
                    note.hit = true;
                    gameState.miss++;
                    gameState.intervalStats.miss++;
                    gameState.combo = 0;
                    gameState.health = Math.max(0, gameState.health - lossOnMiss);
                    this._addMissEffect(note.track);
                    audioEngine.playHitSound('miss');
                }
                continue;
            }

            // 可见 → 绘制
            note.y = rawY;
            this._drawNoteByStyle(positions[note.track].x, rawY, colors[note.track]);
            visibleCount++;
        }

        perfMonitor.visibleNotes = visibleCount;
        perfMonitor.totalNotes = noteCount;
    }

    _drawHoldBody(x, yTop, yBottom, color, isActive) {
        const ctx = this.ctx;
        const trackW = CONFIG.trackWidth;
        const bodyW = trackW - 8;
        const bodyX = x + 4;
        const tailH = 16;
        const bodyTop = yTop + tailH;
        const bodyHeight = yBottom - bodyTop;
        const alpha = isActive ? 0.6 : 0.35;

        if (bodyHeight > 0) {
            ctx.globalAlpha = alpha;
            ctx.fillStyle = color;
            ctx.fillRect(bodyX, bodyTop, bodyW, bodyHeight);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.fillRect(bodyX, bodyTop, 3, bodyHeight);
            ctx.fillRect(bodyX + bodyW - 3, bodyTop, 3, bodyHeight);
            ctx.globalAlpha = 1.0;
        }

        if (yBottom > -50 && yBottom < this.canvasHeight) {
            this._drawNoteByStyle(x, yBottom, color);
        }

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

    _drawNoteByStyle(x, y, color) {
        const ctx = this.ctx;
        const w = CONFIG.trackWidth - 4;
        const h = 24;

        if (noteStyle === 'orb') {
            const radius = CONFIG.trackWidth * 0.475;
            const cx = x + CONFIG.trackWidth / 2;
            const cy = y + h / 2;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.roundRect(x + 2, y, w, h, 6);
            ctx.fill();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.fillRect(x + 2, y, w, 3);
        }
    }

    // ========== 倒计时 ==========
    /** @param {boolean} resumeMode true = 暂停恢复倒计时（数字略小并显示 READY 提示） */
    drawCountdown(secondsLeft, resumeMode = false) {
        if (secondsLeft <= 0) return;
        const ctx = this.ctx;
        const s = this._hudScale;
        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2 - 30 * s;
        const radius = (resumeMode ? 44 : 55) * Math.max(0.85, s);
        const fontSize = (resumeMode ? 42 : 52) * Math.max(0.85, s);

        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius + 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(Math.ceil(secondsLeft).toString(), centerX, centerY + 2);

        ctx.strokeStyle = resumeMode ? '#69db7c' : '#4dabf7';
        ctx.lineWidth = 4;
        ctx.beginPath();
        const progress = 1 - (secondsLeft / (CONFIG.countdownDuration / 1000));
        ctx.arc(centerX, centerY, radius - 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
        ctx.stroke();

        // 恢复模式提示文字
        if (resumeMode) {
            ctx.font = `bold ${13 * Math.max(0.85, s)}px sans-serif`;
            ctx.fillStyle = '#69db7c';
            ctx.fillText('READY', centerX, centerY + radius + 22 * s);
        }
        ctx.textAlign = 'left';
    }

    // ========== 激光 (对象池) ==========
    _getLaser() {
        // 先尝试复用池中已有的非活跃对象
        for (let i = 0; i < this._laserPool.length; i++) {
            if (!this._laserPool[i].active) {
                this._laserPoolIdx = Math.max(this._laserPoolIdx, i + 1);
                return this._laserPool[i];
            }
        }
        // 池已满：覆盖最旧的活跃对象（FIFO 舍弃）
        if (this._laserPool.length >= this._LASER_POOL_MAX) {
            // 找到 timeElapsed 最大的对象覆盖
            let oldestIdx = 0;
            let oldestTime = -1;
            for (let i = 0; i < this._laserPool.length; i++) {
                if (this._laserPool[i].active && this._laserPool[i].timeElapsed > oldestTime) {
                    oldestTime = this._laserPool[i].timeElapsed;
                    oldestIdx = i;
                }
            }
            return this._laserPool[oldestIdx];
        }
        const l = { x: 0, height: 0, color: '', alpha: 0.8, active: true, timeElapsed: 0 };
        this._laserPool.push(l);
        this._laserPoolIdx = this._laserPool.length;
        return l;
    }

    createLaser(track) {
        const l = this._getLaser();
        l.x = this.trackPositions[track].cx;
        l.height = 0;
        l.color = TRACK_COLORS[track];
        l.alpha = 0.8;
        l.active = true;
        l.timeElapsed = 0;
    }

    drawLasers() {
        const ctx = this.ctx;
        const pool = this._laserPool;
        const startY = this._judgmentY;
        const growSpeedRaw = CONFIG.effects.laserGrowSpeed;
        const fadeRateRaw = CONFIG.effects.laserFadeRate;
        const maxDuration = CONFIG.effects.laserMaxDuration * 1000; // ms
        const dt = this._dt;
        const scale = dt / 16.67;
        const growSpeed = growSpeedRaw * scale;
        const fadeRate = fadeRateRaw * scale;
        let validCount = 0;

        for (let i = 0; i < this._laserPoolIdx; i++) {
            const l = pool[i];
            if (!l.active) continue;
            l.timeElapsed += dt;
            l.height += growSpeed;
            l.alpha -= fadeRate;
            if (l.alpha <= 0 || l.timeElapsed > maxDuration) { l.active = false; continue; }
            pool[validCount++] = l;
            ctx.globalAlpha = l.alpha * 0.4;
            ctx.fillStyle = l.color;
            ctx.fillRect(l.x - 2, startY - l.height, 4, l.height);
        }
        this._laserPoolIdx = validCount;
        ctx.globalAlpha = 1.0;
    }

    // ========== 粒子 (对象池) ==========
    _getParticle() {
        // 先尝试复用池中已有的非活跃对象
        for (let i = 0; i < this._particlePool.length; i++) {
            if (!this._particlePool[i].active) {
                this._particlePoolIdx = Math.max(this._particlePoolIdx, i + 1);
                return this._particlePool[i];
            }
        }
        // 池已满：覆盖最旧的活跃对象
        if (this._particlePool.length >= this._PARTICLE_POOL_MAX) {
            let oldestIdx = 0;
            let oldestTime = -1;
            for (let i = 0; i < this._particlePool.length; i++) {
                if (this._particlePool[i].active && this._particlePool[i].timeElapsed > oldestTime) {
                    oldestTime = this._particlePool[i].timeElapsed;
                    oldestIdx = i;
                }
            }
            return this._particlePool[oldestIdx];
        }
        const p = { x: 0, y: 0, vx: 0, vy: 0, size: 0, color: '', life: 0, active: true, timeElapsed: 0 };
        this._particlePool.push(p);
        this._particlePoolIdx = this._particlePool.length;
        return p;
    }

    createHitParticles(y, track, color) {
        const cx = this.trackPositions[track].cx;
        const count = CONFIG.effects.particleCount;
        const speed = CONFIG.effects.particleSpeed;
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count;
            const p = this._getParticle();
            p.x = cx; p.y = y;
            p.vx = Math.cos(angle) * speed;
            p.vy = Math.sin(angle) * speed;
            p.size = 8;
            p.color = color;
            p.life = 1.0;
            p.active = true;
            p.timeElapsed = 0;
        }
    }

    drawParticles() {
        const ctx = this.ctx;
        const pool = this._particlePool;
        const decayRaw = CONFIG.effects.particleLifeDecay;
        const maxDuration = CONFIG.effects.particleMaxDuration * 1000; // ms
        const dt = this._dt;
        const scale = dt / 16.67;
        const decay = decayRaw * scale;
        let validCount = 0;

        for (let i = 0; i < this._particlePoolIdx; i++) {
            const p = pool[i];
            if (!p.active) continue;
            p.timeElapsed += dt;
            p.x += p.vx * scale;
            p.y += p.vy * scale;
            p.life -= decay;
            if (p.life <= 0 || p.timeElapsed > maxDuration) { p.active = false; continue; }
            pool[validCount++] = p;
            ctx.globalAlpha = p.life * 0.6;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
            ctx.fill();
        }
        this._particlePoolIdx = validCount;
        ctx.globalAlpha = 1.0;
    }

    // ========== 判定文字 (对象池) ==========
    _getJudgment() {
        // 先尝试复用池中已有的非活跃对象
        for (let i = 0; i < this._judgmentPool.length; i++) {
            if (!this._judgmentPool[i].active) {
                this._judgmentPoolIdx = Math.max(this._judgmentPoolIdx, i + 1);
                return this._judgmentPool[i];
            }
        }
        // 池已满：覆盖最旧的活跃对象
        if (this._judgmentPool.length >= this._JUDGMENT_POOL_MAX) {
            let oldestIdx = 0;
            let oldestTime = -1;
            for (let i = 0; i < this._judgmentPool.length; i++) {
                if (this._judgmentPool[i].active && this._judgmentPool[i].timeElapsed > oldestTime) {
                    oldestTime = this._judgmentPool[i].timeElapsed;
                    oldestIdx = i;
                }
            }
            return this._judgmentPool[oldestIdx];
        }
        const j = { text: '', y: 0, track: 0, alpha: 1, bounce: 1.2, active: true, timeElapsed: 0 };
        this._judgmentPool.push(j);
        this._judgmentPoolIdx = this._judgmentPool.length;
        return j;
    }

    addJudgment(text, y, track) {
        const j = this._getJudgment();
        j.text = text; j.y = y - 40; j.track = track;
        j.alpha = 1; j.bounce = CONFIG.effects.judgmentInitialBounce; j.active = true;
        j.timeElapsed = 0;
    }

    _addMissEffect(track) {
        const j = this._getJudgment();
        j.text = 'MISS'; j.y = this._judgmentY - 40; j.track = track;
        j.alpha = 1; j.bounce = 1.0; j.active = true;
        j.timeElapsed = 0;
    }

    drawJudgments() {
        const ctx = this.ctx;
        const pool = this._judgmentPool;
        const positions = this.trackPositions;
        const riseSpeedRaw = CONFIG.effects.judgmentRiseSpeed;
        const fadeRateRaw = CONFIG.effects.judgmentFadeRate;
        const maxDuration = CONFIG.effects.judgmentMaxDuration * 1000; // ms
        const dt = this._dt;
        const scale = dt / 16.67;
        const riseSpeed = riseSpeedRaw * scale;
        const fadeRate = fadeRateRaw * scale;
        const bounceDecay = 0.05 * scale;
        let validCount = 0;

        for (let i = 0; i < this._judgmentPoolIdx; i++) {
            const j = pool[i];
            if (!j.active) continue;
            j.timeElapsed += dt;
            j.y -= riseSpeed;
            j.alpha -= fadeRate;
            if (j.bounce > 1.0) j.bounce -= bounceDecay;
            if (j.alpha <= 0 || j.timeElapsed > maxDuration) { j.active = false; continue; }
            pool[validCount++] = j;

            const x = positions[j.track].cx;
            ctx.globalAlpha = j.alpha;
            ctx.font = `bold ${Math.round(14 * j.bounce)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = j.text === 'PERFECT' ? '#ffd43b' : j.text === 'GREAT' ? '#69db7c' : '#ff6b6b';
            ctx.fillText(j.text, x, j.y);
        }
        this._judgmentPoolIdx = validCount;
        ctx.globalAlpha = 1.0;
    }

    // ========== HUD ==========
    drawHUD() {
        const ctx = this.ctx;
        const s = this._hudScale;
        // 矮窗口（横屏手机）时性能面板固定在左上，HUD 整体下移避让
        const perfAvoid = (this.canvasHeight <= 520 && IS_TOUCH_DEVICE) ? 26 : 0;
        const left = this._safeLeft + 30 * s;
        const top = this._safeTop + (30 + perfAvoid) * s;
        ctx.save();

        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${14 * s}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('SCORE', left, top);
        ctx.font = `bold ${28 * s}px sans-serif`;
        ctx.fillStyle = '#4dabf7';
        // 实时最终分 = 判定分 + 连击分，与结算一致
        ctx.fillText(gameState.calculateFinalScore().finalScore.toLocaleString(), left, top + 25 * s);

        const healthW = 140 * s;
        const healthH = 14 * s;
        const hX = this.canvasWidth - this._safeRight - (30 + this._hudRightInset) * s - healthW;
        const hY = this._safeTop + 25 * s;
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.beginPath();
        ctx.roundRect(hX, hY, healthW, healthH, healthH / 2);
        ctx.fill();
        const healthColor = gameState.health > 60 ? '#69db7c' : gameState.health > 30 ? '#ffd43b' : '#ff6b6b';
        ctx.fillStyle = healthColor;
        ctx.beginPath();
        ctx.roundRect(hX, hY, Math.max(0, healthW * gameState.health / CONFIG.health.initial), healthH, healthH / 2);
        ctx.fill();

        if (gameState.combo > 0) {
            ctx.font = `bold ${36 * s}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(gameState.combo, this.canvasWidth / 2, this.canvasHeight / 2 - 10 * s);
            ctx.font = `${12 * s}px sans-serif`;
            ctx.fillStyle = '#aaaaaa';
            ctx.fillText('COMBO', this.canvasWidth / 2, this.canvasHeight / 2 + 22 * s);
        }

        ctx.font = `${13 * s}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffd43b';
        // 窄屏压缩判定统计列间距，防止 P/G/M 溢出屏幕右侧
        const colGap = this._hudCompact ? 72 * s : 100 * s;
        ctx.fillText('P:' + gameState.perfect, left, top + 70 * s);
        ctx.fillStyle = '#69db7c';
        ctx.fillText('G:' + gameState.great, left + colGap, top + 70 * s);
        ctx.fillStyle = '#ff6b6b';
        ctx.fillText('M:' + gameState.miss, left + colGap * 2, top + 70 * s);

        const acc = gameState.calculateTotalAcc();
        ctx.fillStyle = '#ffffff';
        ctx.fillText('ACC:' + acc.toFixed(2) + '%', left, top + 95 * s);

        ctx.restore();
    }

    // ========== 跳过前奏提示 ==========

    /**
     * 音乐已启动且开始后 10s 内仍未到首个音符前 5s 缓冲时，
     * 在判定线附近提示「Press Space to skip」
     */
    drawSkipIntroHint() {
        // 触屏设备使用 DOM 按钮，避免画布提示无法点击
        if (IS_TOUCH_DEVICE) return;
        if (gameState.screen !== 'game' || gameState.paused) return;
        if (!audioEngine.isPlaying || audioEngine._paused) return;

        const sceneTime = performance.now() - gameState.startTime;
        if (sceneTime < 0 || sceneTime > 10000) return;

        const notes = gameState.notes;
        if (!notes || notes.length === 0) return;
        if (sceneTime >= notes[0].time - 5000) return;

        const ctx = this.ctx;
        ctx.save();

        const cx = this.canvasWidth / 2;
        const cy = this._judgmentY;
        const pulse = 0.55 + 0.3 * Math.sin(performance.now() / 280);
        const label = 'Press SPACE ×2 to skip';

        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // 背景发光
        ctx.fillStyle = `rgba(0, 0, 0, ${0.38 * pulse})`;
        const w = ctx.measureText(label).width;
        ctx.beginPath();
        ctx.roundRect(cx - w / 2 - 18, cy - 80, w + 36, 34, 17);
        ctx.fill();

        ctx.fillStyle = `rgba(255, 255, 255, ${pulse.toFixed(3)})`;
        ctx.fillText(label, cx, cy - 63);

        ctx.restore();
    }

    // ========== 暂停遮罩 ==========
    drawPauseOverlay() {
        // 只负责压暗画面；文字与按钮由 #pauseOverlay DOM 提供
        const ctx = this.ctx;
        ctx.fillStyle = 'rgba(5, 5, 12, 0.72)';
        ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
    }

    // ========== 图表 ==========
    drawLineChart(historyData) {
        const chartCanvas = document.getElementById('lineChartCanvas');
        if (!chartCanvas) return;
        const cCtx = chartCanvas.getContext('2d');
        const container = chartCanvas.parentElement;
        if (!container) return;
        const w = Math.max(1, container.clientWidth);
        const h = Math.max(1, container.clientHeight);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        chartCanvas.width = Math.round(w * dpr);
        chartCanvas.height = Math.round(h * dpr);
        chartCanvas.style.width = w + 'px';
        chartCanvas.style.height = h + 'px';
        cCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        cCtx.clearRect(0, 0, w, h);

        if (historyData.length === 0) return;
        // 矮窗口下图表容器只有 ~70px，边距按容器高度自适应，避免内容溢出
        const compact = h < 100;
        const leftMargin = compact ? 34 : 40;
        const topMargin = compact ? 8 : 20;
        const bottomMargin = compact ? 10 : 20;
        const rightMargin = 10;
        const chartW = w - leftMargin - rightMargin;
        const chartH = h - topMargin - bottomMargin;

        cCtx.fillStyle = 'rgba(255,255,255,0.05)';
        cCtx.fillRect(0, 0, w, h);

        let minAcc = 100, maxAcc = 0;
        for (let i = 0; i < historyData.length; i++) {
            const d = historyData[i];
            if (d.totalAcc < minAcc) minAcc = d.totalAcc;
            if (d.totalAcc > maxAcc) maxAcc = d.totalAcc;
        }

        if (minAcc === maxAcc) {
            minAcc = Math.max(0, minAcc - 10);
            maxAcc = Math.min(100, maxAcc + 10);
        }

        const range = maxAcc - minAcc;
        const padding = range * 0.1;
        const yMin = Math.max(0, minAcc - padding);
        const yMax = Math.min(100, maxAcc + padding);
        const yRange = yMax - yMin;

        cCtx.fillStyle = 'rgba(255,255,255,0.5)';
        cCtx.font = compact ? '8px sans-serif' : '10px sans-serif';
        cCtx.textAlign = 'right';

        const yTicks = this._generateYTicks(yMin, yMax);
        // 矮容器时减少刻度数量，避免标签互相重叠
        const tickStride = compact ? 2 : 1;
        for (let i = 0; i < yTicks.length; i += tickStride) {
            const yPos = topMargin + chartH - (chartH * (yTicks[i] - yMin) / yRange);
            cCtx.fillText(yTicks[i].toFixed(0) + '%', leftMargin - 4, yPos + (compact ? 3 : 4));
        }

        cCtx.strokeStyle = 'rgba(255,255,255,0.1)';
        cCtx.lineWidth = 1;
        for (let i = 0; i < yTicks.length; i++) {
            const yPos = topMargin + chartH - (chartH * (yTicks[i] - yMin) / yRange);
            cCtx.beginPath();
            cCtx.moveTo(leftMargin, yPos);
            cCtx.lineTo(leftMargin + chartW, yPos);
            cCtx.stroke();
        }

        const pointSpacing = historyData.length > 1 ? chartW / (historyData.length - 1) : 0;
        cCtx.strokeStyle = '#4dabf7';
        cCtx.lineWidth = 2;
        cCtx.beginPath();
        for (let i = 0; i < historyData.length; i++) {
            const x = leftMargin + i * pointSpacing;
            const normAcc = (historyData[i].totalAcc - yMin) / yRange;
            const y = topMargin + chartH - (chartH * normAcc);
            if (i === 0) cCtx.moveTo(x, y);
            else cCtx.lineTo(x, y);
        }
        cCtx.stroke();

        cCtx.fillStyle = '#4dabf7';
        for (let i = 0; i < historyData.length; i++) {
            const x = leftMargin + i * pointSpacing;
            const normAcc = (historyData[i].totalAcc - yMin) / yRange;
            const y = topMargin + chartH - (chartH * normAcc);
            cCtx.beginPath();
            cCtx.arc(x, y, 3, 0, Math.PI * 2);
            cCtx.fill();
        }
    }

    _generateYTicks(min, max) {
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
            if (i >= min && i <= max) ticks.push(i);
        }
        if (ticks.length < 3) {
            ticks.push(min);
            ticks.push(max);
            ticks.sort((a, b) => a - b);
        }
        return [...new Set(ticks)];
    }

    // ========== 重置对象池 ==========
    resetPools() {
        this._particlePoolIdx = 0;
        this._laserPoolIdx = 0;
        this._judgmentPoolIdx = 0;
        for (let i = 0; i < this._particlePool.length; i++) this._particlePool[i].active = false;
        for (let i = 0; i < this._laserPool.length; i++) this._laserPool[i].active = false;
        for (let i = 0; i < this._judgmentPool.length; i++) this._judgmentPool[i].active = false;
        // 清空触控点（重试/回主页时）
        this._touchPoints.clear();
        this._touchRipples.length = 0;
    }

    // ========== 触控点显示 (移动端) ==========

    /** 手指按下：显示对应轨道颜色的圆环 */
    addTouchPoint(id, x, y, track) {
        if (!touchFeedbackEnabled) return;
        this._touchPoints.set(id, { x, y, track, phase: 'down', age: 0 });
    }

    /** 手指移动：更新触控点位置，跨轨滑动时圆环颜色随新轨道变化 */
    moveTouchPoint(id, x, y, track) {
        const p = this._touchPoints.get(id);
        if (!p) return;
        p.x = x;
        p.y = y;
        if (track !== undefined && track !== p.track) {
            p.track = track;
            p.age = 0;   // 换轨重置呼吸相位，颜色切换更醒目
        }
    }

    /** 手指松开：圆环消失，留下扩散涟漪 */
    removeTouchPoint(id) {
        const p = this._touchPoints.get(id);
        if (p) {
            if (touchFeedbackEnabled) {
                this._touchRipples.push({ x: p.x, y: p.y, track: p.track, age: 0 });
                if (this._touchRipples.length > 12) this._touchRipples.shift();
            }
            this._touchPoints.delete(id);
        }
    }

    /** 清除所有按住中的触控点（暂停/重开时调用），涟漪保留自然消散 */
    resetTouchPoints() {
        this._touchPoints.clear();
    }

    /** 绘制触控点与涟漪（gameLoop 每帧调用） */
    drawTouchPoints() {
        if (!touchFeedbackEnabled) return;
        if (this._touchPoints.size === 0 && this._touchRipples.length === 0) return;

        const ctx = this.ctx;
        const dt = this._dt;
        const scale = dt / 16.67;

        // 按住中：实心半透明圆 + 描边圆环，呼吸微动
        for (const p of this._touchPoints.values()) {
            p.age += dt;
            const color = TRACK_COLORS[p.track] || '#ffffff';
            const breath = 1 + Math.sin(p.age / 180) * 0.06;
            const r = 26 * breath;

            ctx.globalAlpha = 0.18;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();

            ctx.globalAlpha = 0.85;
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.stroke();

            // 中心小圆点
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
            ctx.fill();
        }

        // 松开涟漪：扩散 + 淡出
        let valid = 0;
        for (let i = 0; i < this._touchRipples.length; i++) {
            const rp = this._touchRipples[i];
            rp.age += dt;
            const t = rp.age / 350;              // 0 → 1
            if (t >= 1) continue;                // 结束，不保留
            const color = TRACK_COLORS[rp.track] || '#ffffff';
            const r = 20 + t * 44;
            ctx.globalAlpha = 0.55 * (1 - t);
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5 * (1 - t) + 0.5;
            ctx.beginPath();
            ctx.arc(rp.x, rp.y, r, 0, Math.PI * 2);
            ctx.stroke();
            this._touchRipples[valid++] = rp;
        }
        this._touchRipples.length = valid;
        ctx.globalAlpha = 1.0;
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