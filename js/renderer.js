// ==================== Canvas 渲染器 (性能优化版) ====================

const HUD_FONT_STACK = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
const HUD_MONO_STACK = `'SF Mono', 'Cascadia Mono', 'Fira Code', Consolas, monospace`;

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

        // 游玩界面视觉状态
        this._laneFlash = [0, 0, 0, 0];        // 命中/漏击时的轨道闪光强度 0~1
        this._laneFlashColor = TRACK_COLORS.slice(); // 闪光颜色（命中=轨道色，漏击=红色）
        this._hitPulse = 0;                    // 判定线命中脉冲 0~1
        this._comboPop = 0;                    // 连击数字弹跳动画 0~1
        this._lastCombo = 0;
        this._songInfo = null;                 // { title, artist, difficulty }

        // 预计算轨道坐标
        this.trackPositions = [];   // [{x, cx, hitX, hitW}]

        // 缓存背景
        this._bgGradient = null;
        this._bgVignette = null;
        this._laneFieldGradient = null;
        this._dangerVignette = null;
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

        // playfield 两侧留白：桌面 12px，窄屏按剩余空间收缩，保证不超出画布
        this._fieldPad = Math.min(12, Math.max(0, (this.canvasWidth - totalTrackWidth) / 2 - 2));

        // 让底部触控键与 playfield 同宽（CSS 读取此变量）
        document.documentElement.style.setProperty('--playfield-width', (totalTrackWidth + this._fieldPad * 2) + 'px');

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
        this._bgVignette = null;
        this._laneFieldGradient = null;
        this._dangerVignette = null;

        this.ctx.imageSmoothingEnabled = false;
    }

    /** 设置游戏内顶部显示的曲目信息（开始游戏时由 UI 调用） */
    setSongInfo(info) {
        this._songInfo = info || null;
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

        // 暗角：把视觉焦点收拢到轨道区域，减少边缘干扰
        if (!this._bgVignette) {
            const w = this.canvasWidth;
            const h = this.canvasHeight;
            const g = ctx.createRadialGradient(
                w / 2, h * 0.44, Math.min(w, h) * 0.12,
                w / 2, h * 0.5, Math.max(w, h) * 0.72
            );
            g.addColorStop(0, 'rgba(0,0,0,0)');
            g.addColorStop(0.62, 'rgba(0,0,0,0.18)');
            g.addColorStop(1, 'rgba(0,0,0,0.58)');
            this._bgVignette = g;
        }
        ctx.fillStyle = this._bgVignette;
        ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
    }

    // ========== 轨道 (批量绘制) ==========
    drawTracks() {
        const ctx = this.ctx;
        const positions = this.trackPositions;
        const trackW = CONFIG.trackWidth;
        const h = this.canvasHeight;
        const judgmentY = this._judgmentY;
        const totalWidth = trackW * CONFIG.trackCount + CONFIG.trackSpacing * (CONFIG.trackCount - 1);
        const fieldX = this.trackStartX - this._fieldPad;
        const fieldW = totalWidth + this._fieldPad * 2;
        const scale = this._dt / 16.67;

        // 命中闪光 / 判定线脉冲衰减
        for (let i = 0; i < this._laneFlash.length; i++) {
            if (this._laneFlash[i] > 0) {
                this._laneFlash[i] = Math.max(0, this._laneFlash[i] - 0.075 * scale);
            }
        }
        if (this._hitPulse > 0) this._hitPulse = Math.max(0, this._hitPulse - 0.08 * scale);

        // 专用 playfield 底：顶部渐隐，底部略暗
        if (!this._laneFieldGradient) {
            const g = ctx.createLinearGradient(0, 0, 0, h);
            g.addColorStop(0, 'rgba(8, 8, 15, 0)');
            g.addColorStop(0.16, 'rgba(8, 8, 15, 0.42)');
            g.addColorStop(0.72, 'rgba(8, 8, 15, 0.58)');
            g.addColorStop(1, 'rgba(5, 5, 10, 0.72)');
            this._laneFieldGradient = g;
        }
        ctx.fillStyle = this._laneFieldGradient;
        ctx.fillRect(fieldX, 0, fieldW, h);

        // 交替轨道底色，增强 4K 轨道辨识度
        ctx.fillStyle = 'rgba(255, 255, 255, 0.018)';
        for (let i = 1; i < positions.length; i += 2) {
            ctx.fillRect(positions[i].x, 0, trackW, h);
        }

        // 按下 / 命中光柱
        for (let i = 0; i < positions.length; i++) {
            const pressed = gameState.pressedKeys.has(KEYS[i]);
            const flash = this._laneFlash[i];
            if (!pressed && flash <= 0.01) continue;
            const color = pressed ? TRACK_COLORS[i] : this._laneFlashColor[i];
            const intensity = Math.max(pressed ? 0.17 : 0, flash * 0.42);
            const glowH = Math.min(h * 0.55, 260);
            const g = ctx.createLinearGradient(0, judgmentY - glowH, 0, judgmentY);
            g.addColorStop(0, _withAlpha(color, 0));
            g.addColorStop(1, _withAlpha(color, intensity));
            ctx.fillStyle = g;
            ctx.fillRect(positions[i].x, judgmentY - glowH, trackW, glowH);
            ctx.fillStyle = _withAlpha(color, intensity * 0.35);
            ctx.fillRect(positions[i].x, judgmentY, trackW, 44);
        }

        // 轨道分隔线
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.055)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < positions.length; i++) {
            const x = positions[i].x;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.moveTo(x + trackW, 0);
            ctx.lineTo(x + trackW, h);
        }
        ctx.stroke();

        // playfield 外框
        ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
        ctx.fillRect(fieldX, 0, 1, h);
        ctx.fillRect(fieldX + fieldW - 1, 0, 1, h);

        // 判定线：外层光晕 + 轨道色段 + 白色核心
        const pulse = this._hitPulse;
        ctx.fillStyle = `rgba(255, 255, 255, ${(0.045 + pulse * 0.07).toFixed(3)})`;
        ctx.fillRect(fieldX, judgmentY - 7, fieldW, 14);

        for (let i = 0; i < positions.length; i++) {
            const pressed = gameState.pressedKeys.has(KEYS[i]);
            ctx.fillStyle = _withAlpha(TRACK_COLORS[i], pressed ? 0.85 : 0.3);
            ctx.fillRect(positions[i].x + 1, judgmentY - 1, trackW - 2, 2);
        }

        ctx.fillStyle = `rgba(255, 255, 255, ${(0.55 + pulse * 0.45).toFixed(3)})`;
        ctx.fillRect(fieldX, judgmentY + 0.5, fieldW, 1.5);

        // 判定线上的键位接收器（Key Cap）
        for (let i = 0; i < positions.length; i++) {
            const pressed = gameState.pressedKeys.has(KEYS[i]);
            const cx = positions[i].cx;
            const capW = trackW - 14;
            const capX = cx - capW / 2;
            const color = TRACK_COLORS[i];

            if (pressed) {
                ctx.globalAlpha = 0.28;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.roundRect(capX - 4, judgmentY - 8, capW + 8, 16, 8);
                ctx.fill();
                ctx.globalAlpha = 1;
            }

            ctx.globalAlpha = pressed ? 1 : 0.38;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.roundRect(capX, judgmentY - 3, capW, 6, 3);
            ctx.fill();

            ctx.globalAlpha = pressed ? 0.65 : 0.22;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.roundRect(capX + 2, judgmentY - 2.5, capW - 4, 2, 1);
            ctx.fill();
            ctx.globalAlpha = 1;
        }

        // 桌面端在判定线下方显示键位提示
        if (!IS_TOUCH_DEVICE) {
            const s = this._hudScale;
            ctx.font = `700 ${10 * s}px ${HUD_FONT_STACK}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
            for (let i = 0; i < positions.length; i++) {
                ctx.fillText(TRACK_KEYS[i], positions[i].cx, judgmentY + 20 * s);
            }
        }
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

                // 按住中：计算 hold 进度（0=头部命中时刻, 1=尾部到达），
                // 用于长条体的进度亮度渐变
                const holdProgress = note.holdActive && note.startTime !== undefined
                    ? Math.max(0, Math.min(1, (currentTime - note.startTime) / (note.endTime - note.startTime)))
                    : 0;

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

                this._drawHoldBody(pos.x, visYTop, visYBot, colors[note.track], note.holdActive, holdProgress);
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

    /**
     * 绘制 Hold 长条体
     * @param {boolean} isActive - 是否按住中
     * @param {number} holdProgress - 按住进度 0~1（未按住时为 0），
     *   按住中的长条体以亮度渐变显示进度：已按过部分更亮，未到部分较暗
     */
    _drawHoldBody(x, yTop, yBottom, color, isActive, holdProgress = 0) {
        const ctx = this.ctx;
        const trackW = CONFIG.trackWidth;
        const bodyW = trackW - 8;
        const bodyX = x + 4;
        const tailH = 16;
        const bodyTop = yTop + tailH;
        const bodyHeight = yBottom - bodyTop;
        const alpha = isActive ? 0.6 : 0.35;

        if (bodyHeight > 0) {
            if (isActive && holdProgress > 0) {
                // 按住中：上下分段渐变（底部=已按过部分=更亮，顶部=未到部分=较暗）
                // 判定线在屏幕下方、音符自上而落，长条尾部(下方)先经过判定线；
                // 进度从头部开始累积，用垂直渐变表达：越接近判定线越亮
                const grad = ctx.createLinearGradient(0, bodyTop, 0, yBottom);
                const litAlpha = Math.min(0.95, 0.45 + holdProgress * 0.5);
                grad.addColorStop(0, _withAlpha(color, 0.4));
                grad.addColorStop(1, _withAlpha(color, litAlpha));
                ctx.globalAlpha = 1;
                ctx.fillStyle = grad;
            } else {
                ctx.globalAlpha = alpha;
                ctx.fillStyle = color;
            }

            ctx.beginPath();
            ctx.roundRect(bodyX, bodyTop, bodyW, bodyHeight, 4);
            ctx.fill();

            // 内部高光条 + 中央细线，长条更有材质感
            ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
            ctx.fillRect(bodyX + 3, bodyTop, 3, bodyHeight);
            ctx.fillRect(bodyX + bodyW - 6, bodyTop, 3, bodyHeight);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.fillRect(bodyX + bodyW / 2 - 1, bodyTop, 2, bodyHeight);

            // 按住中：判定线附近额外亮起，强调持续输入
            if (isActive) {
                const glowH = Math.min(80, bodyHeight);
                const glow = ctx.createLinearGradient(0, yBottom - glowH, 0, yBottom);
                glow.addColorStop(0, _withAlpha(color, 0));
                glow.addColorStop(1, _withAlpha(color, 0.35));
                ctx.fillStyle = glow;
                ctx.fillRect(bodyX, yBottom - glowH, bodyW, glowH);
            }
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
            const radius = CONFIG.trackWidth * 0.45;
            const cx = x + CONFIG.trackWidth / 2;
            const cy = y + h / 2;

            // 外圈柔光
            ctx.globalAlpha = 0.16;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;

            // 主体
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fill();

            // 顶部高光 + 白色描边，提升立体感
            ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
            ctx.beginPath();
            ctx.arc(cx - radius * 0.16, cy - radius * 0.2, radius * 0.58, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(cx, cy, radius - 0.75, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            const nx = x + 2;

            // 外圈柔光
            ctx.globalAlpha = 0.14;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.roundRect(nx - 2, y - 2, w + 4, h + 4, 8);
            ctx.fill();
            ctx.globalAlpha = 1;

            // 主体
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.roundRect(nx, y, w, h, 6);
            ctx.fill();

            // 顶部高光 + 底部暗边
            ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
            ctx.beginPath();
            ctx.roundRect(nx + 2, y + 2, w - 4, 6, 3);
            ctx.fill();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
            ctx.fillRect(nx + 2, y + h - 4, w - 4, 2);

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(nx + 0.5, y + 0.5, w - 1, h - 1, 5.5);
            ctx.stroke();
        }
    }

    // ========== 倒计时 ==========
    /** @param {boolean} resumeMode true = 暂停恢复倒计时（数字略小并显示 READY 提示） */
    drawCountdown(secondsLeft, resumeMode = false) {
        if (secondsLeft <= 0) return;
        const ctx = this.ctx;
        const s = this._hudScale;
        const w = this.canvasWidth;
        const h = this.canvasHeight;
        const centerX = w / 2;
        const centerY = h * 0.46;
        const color = resumeMode ? '#69db7c' : '#4dabf7';
        const frac = secondsLeft - Math.floor(secondsLeft);
        const radius = (resumeMode ? 46 : 58) * Math.max(0.85, s) * (1 + frac * 0.045);
        const fontSize = (resumeMode ? 44 : 56) * Math.max(0.85, s);

        ctx.save();

        // 倒计时期间压暗画面，把注意力集中到中央
        ctx.fillStyle = 'rgba(4, 4, 10, 0.42)';
        ctx.fillRect(0, 0, w, h);

        // 外圈柔光
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius + 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        // 底环
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 5 * s;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.stroke();

        // 进度环
        const progress = Math.max(0, Math.min(1, 1 - (secondsLeft / (CONFIG.countdownDuration / 1000))));
        ctx.strokeStyle = color;
        ctx.lineCap = 'round';
        ctx.shadowColor = color;
        ctx.shadowBlur = 16 * s;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.lineCap = 'butt';

        // 数字
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `800 ${fontSize}px ${HUD_MONO_STACK}`;
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = color;
        ctx.shadowBlur = 18 * s;
        ctx.fillText(Math.ceil(secondsLeft).toString(), centerX, centerY + 2 * s);
        ctx.shadowBlur = 0;

        // 状态标签
        ctx.font = `700 ${10 * s}px ${HUD_FONT_STACK}`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
        ctx.fillText(resumeMode ? 'R E S U M E' : 'G E T   R E A D Y', centerX, centerY - radius - 24 * s);
        ctx.fillStyle = color;
        ctx.fillText(resumeMode ? 'BACK IN' : 'STAY ON BEAT', centerX, centerY + radius + 26 * s);

        ctx.textAlign = 'left';
        ctx.restore();
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

        // 命中反馈：轨道光柱 + 判定线脉冲
        this._laneFlash[track] = 1;
        this._laneFlashColor[track] = TRACK_COLORS[track];
        this._hitPulse = 1;
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

        // 漏击：轨道短暂泛红提示
        this._laneFlash[track] = 0.85;
        this._laneFlashColor[track] = '#ff6b6b';
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
            const isPerfect = j.text === 'PERFECT';
            const isGreat = j.text === 'GREAT';
            const color = isPerfect ? '#ffd43b' : isGreat ? '#69db7c' : '#ff6b6b';
            const baseSize = isPerfect ? 17 : isGreat ? 15 : 16;
            ctx.globalAlpha = j.alpha;
            ctx.font = `800 ${Math.round(baseSize * this._hudScale * j.bounce)}px ${HUD_FONT_STACK}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 12 * this._hudScale;
            ctx.fillText(j.text, x, j.y);
            ctx.shadowBlur = 0;
        }
        this._judgmentPoolIdx = validCount;
        ctx.globalAlpha = 1.0;
    }

    // ========== HUD ==========
    drawHUD() {
        const ctx = this.ctx;
        const s = this._hudScale;
        const w = this.canvasWidth;
        const h = this.canvasHeight;
        const now = performance.now();
        // 暂停 / 恢复倒计时期间：进度按冻结时刻显示，避免进度条倒计时中前跳
        const frozen = gameState.paused || gameState.resumeCountdownUntil > 0;
        const currentTime = frozen
            ? (gameState.pauseSnapshotTime || 0)
            : Math.max(0, now - gameState.startTime);
        const scale = this._dt / 16.67;

        // 连击弹跳动画状态
        if (gameState.combo > this._lastCombo) this._comboPop = 1;
        if (gameState.combo <= 0) this._comboPop = 0;
        this._lastCombo = gameState.combo;
        if (this._comboPop > 0) this._comboPop = Math.max(0, this._comboPop - 0.07 * scale);

        // 矮窗口（横屏手机）时性能面板固定在左上，HUD 整体下移避让
        const perfAvoid = (h <= 520 && IS_TOUCH_DEVICE) ? 26 : 0;
        const left = this._safeLeft + 26 * s;
        const top = this._safeTop + (22 + perfAvoid) * s;

        ctx.save();

        // ---- 顶部歌曲进度条 ----
        this._drawProgressBar(currentTime);

        // ---- 低血量红色暗角 ----
        const healthInitial = CONFIG.health.initial || 100;
        const healthRatio = Math.max(0, Math.min(1, gameState.health / healthInitial));
        if (healthRatio < 0.3) {
            if (!this._dangerVignette) {
                const g = ctx.createRadialGradient(
                    w / 2, h * 0.5, Math.min(w, h) * 0.24,
                    w / 2, h * 0.5, Math.max(w, h) * 0.7
                );
                g.addColorStop(0, 'rgba(255, 60, 60, 0)');
                g.addColorStop(1, 'rgba(255, 40, 60, 0.55)');
                this._dangerVignette = g;
            }
            const pulse = 0.55 + 0.45 * Math.sin(now / 170);
            ctx.globalAlpha = (1 - healthRatio / 0.3) * pulse;
            ctx.fillStyle = this._dangerVignette;
            ctx.fillRect(0, 0, w, h);
            ctx.globalAlpha = 1;
        }

        // ---- 左上：分数 / 准确率 / 判定统计 ----
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        ctx.font = `600 ${9.5 * s}px ${HUD_FONT_STACK}`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
        ctx.fillText('SCORE', left, top);

        const scoreText = gameState.calculateFinalScore().finalScore.toLocaleString();
        ctx.font = `800 ${30 * s}px ${HUD_MONO_STACK}`;
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(77, 171, 247, 0.55)';
        ctx.shadowBlur = 14 * s;
        ctx.fillText(scoreText, left, top + 13 * s);
        ctx.shadowBlur = 0;

        const acc = gameState.calculateTotalAcc();
        ctx.font = `600 ${9.5 * s}px ${HUD_FONT_STACK}`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
        ctx.fillText('ACCURACY', left, top + 48 * s);
        ctx.font = `700 ${14 * s}px ${HUD_MONO_STACK}`;
        ctx.fillStyle = '#a5d8ff';
        ctx.fillText(acc.toFixed(2) + '%', left, top + 60 * s);

        const countsY = top + 83 * s;
        const counts = [
            { label: 'P', value: gameState.perfect, color: '#ffd43b' },
            { label: 'G', value: gameState.great, color: '#69db7c' },
            { label: 'M', value: gameState.miss, color: '#ff6b6b' }
        ];
        let cx = left;
        for (let i = 0; i < counts.length; i++) {
            const item = counts[i];
            ctx.font = `800 ${10.5 * s}px ${HUD_FONT_STACK}`;
            ctx.fillStyle = item.color;
            ctx.fillText(item.label, cx, countsY);
            const labelW = ctx.measureText(item.label).width;

            const valueText = String(item.value);
            ctx.font = `700 ${13 * s}px ${HUD_MONO_STACK}`;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.fillText(valueText, cx + labelW + 5 * s, countsY - 1 * s);
            const valueW = ctx.measureText(valueText).width;

            cx += labelW + valueW + (this._hudCompact ? 12 : 18) * s;
        }

        // ---- 右上：生命值 ----
        const healthW = Math.min(210 * s, w * 0.34);
        const healthH = 7 * s;
        const hX = w - this._safeRight - this._hudRightInset - healthW - 24 * s;
        const hY = this._safeTop + (30 + perfAvoid) * s;
        const healthColor = healthRatio > 0.6 ? '#69db7c' : healthRatio > 0.3 ? '#ffd43b' : '#ff6b6b';

        ctx.textAlign = 'right';
        ctx.font = `600 ${9 * s}px ${HUD_FONT_STACK}`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.fillText('LIFE', hX + healthW, hY - 12 * s);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.beginPath();
        ctx.roundRect(hX, hY, healthW, healthH, healthH / 2);
        ctx.fill();

        if (healthRatio > 0) {
            ctx.globalAlpha = healthRatio < 0.3 ? 0.7 + 0.3 * Math.sin(now / 150) : 1;
            ctx.fillStyle = healthColor;
            ctx.shadowColor = healthColor;
            ctx.shadowBlur = 8 * s;
            ctx.beginPath();
            ctx.roundRect(hX, hY, healthW * healthRatio, healthH, healthH / 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
        }

        // 30% 危险刻度
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(hX + healthW * 0.3, hY, 1, healthH);

        // ---- 顶部中央：曲目信息 + 判定偏移条 ----
        if (this._songInfo && w >= 780) {
            const centerX = w / 2;
            const maxTitleW = Math.min(w * 0.3, 300);

            ctx.textAlign = 'center';
            ctx.font = `700 ${15 * s}px ${HUD_FONT_STACK}`;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
            ctx.fillText(this._fitText(this._songInfo.title || '', maxTitleW, ctx), centerX, top);

            const meta = [this._songInfo.artist, this._songInfo.difficulty].filter(Boolean).join('   ·   ');
            if (meta) {
                ctx.font = `600 ${9.5 * s}px ${HUD_FONT_STACK}`;
                ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.fillText(this._fitText(meta, maxTitleW, ctx), centerX, top + 20 * s);
            }

            this._drawTimingBar(centerX, top + 42 * s);
        }

        // ---- 中央连击 ----
        // 恢复倒计时期间隐藏连击，避免与 3-2-1 圆环重叠
        if (gameState.combo > 0 && !(gameState.resumeCountdownUntil > 0)) {
            const pop = 1 + this._comboPop * 0.18;
            const size = 46 * s * pop;
            const comboX = w / 2;
            const comboY = h * 0.34;
            const hotCombo = gameState.combo >= 50;

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const grad = ctx.createLinearGradient(0, comboY - size * 0.55, 0, comboY + size * 0.4);
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(1, hotCombo ? '#ffd43b' : '#74c0fc');
            ctx.font = `800 ${size}px ${HUD_MONO_STACK}`;
            ctx.fillStyle = grad;
            ctx.shadowColor = hotCombo ? 'rgba(255, 212, 59, 0.55)' : 'rgba(77, 171, 247, 0.5)';
            ctx.shadowBlur = 20 * s;
            ctx.fillText(gameState.combo, comboX, comboY);
            ctx.shadowBlur = 0;

            ctx.font = `700 ${10 * s}px ${HUD_FONT_STACK}`;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
            ctx.fillText('C O M B O', comboX, comboY + size * 0.62);

            ctx.textBaseline = 'top';
        }

        ctx.restore();
    }

    /** 顶部细进度条：显示当前曲目播放进度 */
    _drawProgressBar(currentTime) {
        const ctx = this.ctx;
        const s = this._hudScale;
        const x = this._safeLeft + 14 * s;
        const y = this._safeTop + 4 * s;
        const w = this.canvasWidth - this._safeLeft - this._safeRight - 28 * s;
        const barH = 3 * s;

        let total = CONFIG.songDuration;
        const chart = (typeof getLoadedChartData === 'function') ? getLoadedChartData() : null;
        if (chart && chart.meta && chart.meta.duration) {
            total = chart.meta.duration * 1000;
        } else if (typeof loadedMidiData !== 'undefined' && loadedMidiData && loadedMidiData.duration) {
            total = loadedMidiData.duration * 1000;
        }
        if (typeof audioEngine !== 'undefined' && audioEngine.audioBuffer) {
            total = Math.max(total, audioEngine.audioBuffer.duration * 1000);
        }

        const p = total > 0 ? Math.max(0, Math.min(1, currentTime / total)) : 0;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
        ctx.fillRect(x, y, w, barH);

        if (p <= 0) return;

        const grad = ctx.createLinearGradient(x, 0, x + w, 0);
        grad.addColorStop(0, 'rgba(77, 171, 247, 0.75)');
        grad.addColorStop(0.6, 'rgba(151, 117, 250, 0.85)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0.95)');
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, w * p, barH);

        // 播放头
        const headX = x + w * p;
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#a5d8ff';
        ctx.beginPath();
        ctx.arc(headX, y + barH / 2, 5 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(headX, y + barH / 2, 2.4 * s, 0, Math.PI * 2);
        ctx.fill();
    }

    /** 判定偏移条：显示最近一次打击的 EARLY / LATE 偏差 */
    _drawTimingBar(cx, y) {
        const lastAt = gameState.lastHitAt || 0;
        if (!lastAt) return;
        const age = performance.now() - lastAt;
        if (age > 1200) return;

        const ctx = this.ctx;
        const s = this._hudScale;
        const width = 150 * s;
        const barH = 3 * s;
        const x = cx - width / 2;
        const range = 120; // ±120ms 映射到进度条两端

        ctx.globalAlpha = 0.35 + (1 - Math.min(1, age / 1200)) * 0.65;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.beginPath();
        ctx.roundRect(x, y, width, barH, barH / 2);
        ctx.fill();

        // Perfect 窗口高亮
        const perfectW = (CONFIG.perfectWindow / range) * (width / 2);
        ctx.fillStyle = 'rgba(255, 212, 59, 0.22)';
        ctx.fillRect(cx - perfectW, y, perfectW * 2, barH);

        // 中心基准线
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.fillRect(cx - 0.5, y - 2 * s, 1, barH + 4 * s);

        const offset = Math.max(-range, Math.min(range, gameState.lastHitOffset || 0));
        const markerX = cx + (offset / range) * (width / 2);
        const color = Math.abs(offset) <= CONFIG.perfectWindow ? '#ffd43b' : '#69db7c';

        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8 * s;
        ctx.beginPath();
        ctx.arc(markerX, y + barH / 2, 3 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.globalAlpha = 1;
    }

    /** 按可用宽度截断文本并追加省略号 */
    _fitText(text, maxWidth, ctx) {
        if (!text) return '';
        if (ctx.measureText(text).width <= maxWidth) return text;
        let t = text;
        while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) {
            t = t.slice(0, -1);
        }
        return t + '…';
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
        const s = this._hudScale;
        ctx.save();

        const cx = this.canvasWidth / 2;
        const cy = this._judgmentY;
        const pulse = 0.55 + 0.3 * Math.sin(performance.now() / 280);
        const label = 'SPACE ×2 跳过前奏';
        const pillH = 30 * s;
        const pillY = cy - 92 * s;

        ctx.font = `600 ${11 * s}px ${HUD_FONT_STACK}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const pillW = ctx.measureText(label).width + 34 * s;

        // 半透明胶囊底 + 霓虹描边，与游戏内按钮语言一致
        ctx.globalAlpha = pulse;
        ctx.fillStyle = 'rgba(10, 10, 18, 0.72)';
        ctx.beginPath();
        ctx.roundRect(cx - pillW / 2, pillY, pillW, pillH, pillH / 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(77, 171, 247, 0.42)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // 文字：双击空格跳过前奏
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillText(label, cx, pillY + pillH / 2);
        ctx.globalAlpha = 1;

        ctx.restore();
    }

    // ========== 暂停遮罩 ==========
    drawPauseOverlay() {
        // 画面保持冻结可见，压暗与毛玻璃由 #pauseOverlay DOM 提供，
        // 避免画布与 DOM 两层遮罩叠加导致场景几乎全黑
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

        // 重置游玩界面视觉状态
        for (let i = 0; i < this._laneFlash.length; i++) {
            this._laneFlash[i] = 0;
            this._laneFlashColor[i] = TRACK_COLORS[i];
        }
        this._hitPulse = 0;
        this._comboPop = 0;
        this._lastCombo = 0;
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

// hex 颜色转 rgba 字符串（hold 进度渐变用）
function _withAlpha(hexColor, alpha) {
    if (hexColor[0] !== '#') return hexColor;
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
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