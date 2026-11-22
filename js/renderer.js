// ==================== Canvas 渲染器 (性能优化版) ====================

const HUD_FONT_STACK = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
const HUD_MONO_STACK = `'SF Mono', 'Cascadia Mono', 'Fira Code', Consolas, monospace`;

// 扁平配色：纯色块 + 纯色文字，不依赖渐变 / 发光
const FLAT_PALETTE = {
    bg: '#0b0b12',
    field: '#12121b',
    laneAlt: '#16161f',
    fieldBorder: 'rgba(255, 255, 255, 0.1)',
    laneLine: 'rgba(255, 255, 255, 0.06)',
    text: '#ffffff',
    textDim: 'rgba(255, 255, 255, 0.45)',
    track: 'rgba(255, 255, 255, 0.1)'
};

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

        // 皮肤（Malody V）：null = 内置扁平皮肤
        this.skin = null;
        this._skinScale = 1;
        this._accent = '#4dabf7';

        // 预计算轨道坐标
        this.trackPositions = [];   // [{x, cx, hitX, hitW}]

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

        if (this.skin) {
            // Malody 皮肤：轨道宽度/间距由皮肤脚本决定（4K = 100 宽 + 5 间距，整块 420）
            // 上限 1.0：设计单位 1:1 绘制，宽屏下不再放大成巨型轨道
            const layout = this.skin.layout;
            const fieldUnits = layout.laneWidth * CONFIG.trackCount + layout.laneGap * (CONFIG.trackCount - 1);
            const scale = Math.max(0.5, Math.min(availableWidth / fieldUnits, 1));
            this._skinScale = scale;
            CONFIG.trackWidth = Math.round(layout.laneWidth * scale);
            CONFIG.trackSpacing = Math.max(0, Math.round(layout.laneGap * scale));
        } else {
            const fittedWidth = Math.floor((availableWidth - gap * (CONFIG.trackCount - 1)) / CONFIG.trackCount);
            CONFIG.trackWidth = Math.max(44, Math.min(80, fittedWidth));
            CONFIG.trackSpacing = gap;
            this._skinScale = 1;
        }

        const totalTrackWidth = CONFIG.trackCount * CONFIG.trackWidth + (CONFIG.trackCount - 1) * CONFIG.trackSpacing;
        this.trackStartX = (this.canvasWidth - totalTrackWidth) / 2;

        if (this.skin) {
            // 皮肤判定线两侧的留白（bar 比 field 宽 40 单位）
            const barPad = Math.max(0, (this.skin.layout.barWidth - this.skin.layout.fieldWidth) / 2) * this._skinScale;
            this._fieldPad = Math.min(barPad, Math.max(0, (this.canvasWidth - totalTrackWidth) / 2 - 1));
        } else {
            // playfield 两侧留白：桌面 12px，窄屏按剩余空间收缩，保证不超出画布
            this._fieldPad = Math.min(12, Math.max(0, (this.canvasWidth - totalTrackWidth) / 2 - 2));
        }
        this._fieldWidth = totalTrackWidth + this._fieldPad * 2;

        // 皮肤判定线贴图实际宽度（窄屏夹到画布内）
        this._barW = this.skin
            ? Math.min(this.skin.layout.barWidth * this._skinScale, this.canvasWidth - 4)
            : this._fieldWidth;

        // 让底部触控键与 playfield 同宽（CSS 读取此变量）
        document.documentElement.style.setProperty('--playfield-width', this._fieldWidth + 'px');

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
        // 内置皮肤用 CONFIG.judgmentLineY；Malody 皮肤由脚本的 HITPOSITION 决定（越大越靠上）
        const desiredY = this.skin
            ? reservedBottom + (this.canvasHeight - reservedBottom) * this.skin.hitFraction
            : this.canvasHeight * CONFIG.judgmentLineY;
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

        this.ctx.imageSmoothingEnabled = false;
    }

    /** 设置游戏内顶部显示的曲目信息（开始游戏时由 UI 调用） */
    setSongInfo(info) {
        this._songInfo = info || null;
    }

    /**
     * 启用/关闭 Malody 皮肤
     * @param {MalodySkin|null} skin
     */
    setSkin(skin) {
        this.skin = skin || null;
        this.spritesReady = !!(skin && skin.isPlayfieldReady);
        this._accent = skin ? skin.accentColor : '#4dabf7';
        // 轨道几何与判定线依赖皮肤布局，重新计算
        this.resize();
    }

    // ========== 背景（扁平纯色） ==========
    drawBackground(time) {
        const ctx = this.ctx;
        // 扁平设计：单一纯色底面，不用渐变与暗角，轨道区域的层次交给 drawTracks 的色块
        ctx.fillStyle = FLAT_PALETTE.bg;
        ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
    }

    // ========== 轨道（扁平色块 / Malody 皮肤） ==========
    drawTracks() {
        const scale = this._dt / 16.67;

        // 命中闪光 / 判定线脉冲衰减（两种皮肤共用）
        for (let i = 0; i < this._laneFlash.length; i++) {
            if (this._laneFlash[i] > 0) {
                this._laneFlash[i] = Math.max(0, this._laneFlash[i] - 0.075 * scale);
            }
        }
        if (this._hitPulse > 0) this._hitPulse = Math.max(0, this._hitPulse - 0.08 * scale);

        if (this.skin && this.spritesReady) {
            this._drawSkinTracks();
            return;
        }
        this._drawFlatTracks();
    }

    /** Malody 皮肤：背景板 / 底部填充 / 键位列 / 按下列 / 接收器 / 判定线 */
    _drawSkinTracks() {
        const ctx = this.ctx;
        const skin = this.skin;
        const s = this._skinScale;
        const positions = this.trackPositions;
        const trackW = CONFIG.trackWidth;
        const h = this.canvasHeight;
        const jy = this._judgmentY;
        const fieldX = this.trackStartX - this._fieldPad;
        const fieldW = this._fieldWidth;
        const layout = skin.layout;

        // 1. 轨道底板（Ybg 铺满 playfield）
        skin.drawSprite(ctx, 'Ybg', fieldX, 0, fieldW, h);

        // 2. 判定线以下：底部填充贴图
        const bottomH = Math.max(0, h - jy);
        for (let i = 0; i < positions.length; i++) {
            skin.drawLaneSprite(ctx, '_bottom', i, positions[i].x, jy, trackW, bottomH);
        }

        // 3. 键位提示列（贴图本身很淡，只做轨道轮廓）
        const keyH = layout.keyHeight * s;
        for (let i = 0; i < positions.length; i++) {
            skin.drawLaneSprite(ctx, 'key', i, positions[i].x, jy - keyH, trackW, keyH);
        }

        // 4. 按下列：白底贴图按轨道色着色，opacity 来自脚本（35%）
        const pressH = layout.pressHeight * s;
        for (let i = 0; i < positions.length; i++) {
            if (!gameState.pressedKeys.has(KEYS[i])) continue;
            skin.drawLaneSprite(ctx, 'press', i, positions[i].x, jy - pressH, trackW, pressH, {
                useElementColor: true,
                useElementOpacity: true
            });
        }

        // 5. 接收器：判定线处的音符剪影（opacity 10%）
        const noteH = layout.noteHeight * s;
        for (let i = 0; i < positions.length; i++) {
            const flash = this._laneFlash[i];
            skin.drawLaneSprite(ctx, '_receptors', i, positions[i].x, jy - noteH / 2, trackW, noteH, {
                useElementOpacity: true,
                alpha: 1 + flash * 4
            });
        }

        // 6. 判定线：Ybar4k（bar 比 field 宽，居中绘制；窄屏下夹到画布内）
        const barW = this._barW;
        const barH = Math.max(2, layout.barHeight * s);
        const barX = this.canvasWidth / 2 - barW / 2;
        const barY = jy - barH / 2;
        if (!skin.drawSprite(ctx, 'Ybar4k', barX, barY, barW, barH, { alpha: 1 })) {
            // 兜底：贴图缺失时画一条纯色线
            ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.fillRect(fieldX, Math.round(jy) - 1, fieldW, 2);
        }
    }

    /** 内置扁平皮肤：纯色块轨道 */
    _drawFlatTracks() {
        const ctx = this.ctx;
        const positions = this.trackPositions;
        const trackW = CONFIG.trackWidth;
        const h = this.canvasHeight;
        const judgmentY = this._judgmentY;
        const fieldX = this.trackStartX - this._fieldPad;
        const fieldW = this._fieldWidth;

        // 轨道区：纯色块 + 交替轨底色
        ctx.fillStyle = FLAT_PALETTE.field;
        ctx.fillRect(fieldX, 0, fieldW, h);
        ctx.fillStyle = FLAT_PALETTE.laneAlt;
        for (let i = 1; i < positions.length; i += 2) {
            ctx.fillRect(positions[i].x, 0, trackW, h);
        }

        // 按下 / 命中 / 漏击：实色块提示（不使用渐变光柱）
        for (let i = 0; i < positions.length; i++) {
            const pressed = gameState.pressedKeys.has(KEYS[i]);
            const flash = this._laneFlash[i];
            if (!pressed && flash <= 0.01) continue;
            const color = pressed ? TRACK_COLORS[i] : this._laneFlashColor[i];

            // 按住时整轨淡色底
            if (pressed) {
                ctx.fillStyle = _withAlpha(color, 0.1);
                ctx.fillRect(positions[i].x, 0, trackW, judgmentY);
            }

            // 命中 / 漏击：判定线上方一条实色横带
            if (flash > 0.01) {
                const bandH = 54;
                ctx.fillStyle = _withAlpha(color, 0.09 + flash * 0.13);
                ctx.fillRect(positions[i].x, judgmentY - bandH, trackW, bandH);
            }
        }

        // 轨道分隔线 + 外框：1px 实线
        ctx.fillStyle = FLAT_PALETTE.laneLine;
        for (let i = 0; i <= positions.length; i++) {
            const x = i < positions.length ? positions[i].x : positions[positions.length - 1].x + trackW;
            ctx.fillRect(Math.round(x), 0, 1, h);
        }
        ctx.fillStyle = FLAT_PALETTE.fieldBorder;
        ctx.fillRect(Math.round(fieldX), 0, 1, h);
        ctx.fillRect(Math.round(fieldX + fieldW) - 1, 0, 1, h);

        // 判定线：2px 纯白主线（命中时短暂加粗到 3px，不用发光）
        const lineH = this._hitPulse > 0.1 ? 3 : 2;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.fillRect(fieldX, Math.round(judgmentY - lineH / 2), fieldW, lineH);

        for (let i = 0; i < positions.length; i++) {
            const pressed = gameState.pressedKeys.has(KEYS[i]);
            // 轨道色刻度：未按下 8px，按下时整条轨道色块加粗
            ctx.fillStyle = TRACK_COLORS[i];
            ctx.globalAlpha = pressed ? 1 : 0.55;
            ctx.fillRect(positions[i].x + 1, judgmentY + 2, trackW - 2, 3);
            ctx.globalAlpha = 1;
        }

        // 键位接收器：扁平圆角块
        for (let i = 0; i < positions.length; i++) {
            const pressed = gameState.pressedKeys.has(KEYS[i]);
            const cx = positions[i].cx;
            const capW = trackW - 18;
            const capH = 10;
            const capX = Math.round(cx - capW / 2);
            const capY = Math.round(judgmentY - capH / 2);
            const color = TRACK_COLORS[i];

            ctx.fillStyle = pressed ? color : FLAT_PALETTE.field;
            ctx.beginPath();
            ctx.roundRect(capX, capY, capW, capH, 2);
            ctx.fill();

            ctx.strokeStyle = pressed ? color : _withAlpha(color, 0.55);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(capX + 0.5, capY + 0.5, capW - 1, capH - 1, 2);
            ctx.stroke();
        }

        // 桌面端在判定线下方显示键位提示
        if (!IS_TOUCH_DEVICE) {
            const s = this._hudScale;
            ctx.font = `700 ${10 * s}px ${HUD_FONT_STACK}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
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

                this._drawHoldBody(pos.x, visYTop, visYBot, colors[note.track], note.holdActive, holdProgress, note.track);
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
            this._drawNoteByStyle(positions[note.track].x, rawY, colors[note.track], note.track);
            visibleCount++;
        }

        perfMonitor.visibleNotes = visibleCount;
        perfMonitor.totalNotes = noteCount;
    }

    /**
     * 绘制 Hold 长条体
     * 内置扁平：实色块 + 1px 描边；Malody 皮肤：YnoteL 长条体 + YnoteT 尾部
     * @param {boolean} isActive - 是否按住中
     * @param {number} holdProgress - 按住进度 0~1（未按住时为 0）
     * @param {number} [track] - 轨道索引（皮肤按轨道取贴图）
     */
    _drawHoldBody(x, yTop, yBottom, color, isActive, holdProgress = 0, track = 0) {
        const skin = this.skin;
        if (skin && this.spritesReady) {
            this._drawSkinHoldBody(x, yTop, yBottom, isActive, holdProgress, track);
            return;
        }

        const ctx = this.ctx;
        const trackW = CONFIG.trackWidth;
        const bodyW = trackW - 8;
        const bodyX = x + 4;
        const tailH = 14;
        const bodyTop = yTop + tailH;
        const bodyHeight = yBottom - bodyTop;
        const radius = noteStyle === 'pixel' ? 1 : 3;

        if (bodyHeight > 0) {
            // 长条主体：低调实色
            ctx.fillStyle = _withAlpha(color, isActive ? 0.32 : 0.22);
            ctx.fillRect(bodyX, bodyTop, bodyW, bodyHeight);

            // 左右 1px 描边，替代高光条
            ctx.fillStyle = _withAlpha(color, isActive ? 0.9 : 0.6);
            ctx.fillRect(bodyX, bodyTop, 1, bodyHeight);
            ctx.fillRect(bodyX + bodyW - 1, bodyTop, 1, bodyHeight);

            // 按住进度：从判定线一侧向上生长的实色块
            if (isActive && holdProgress > 0) {
                const litH = Math.max(2, bodyHeight * Math.min(1, holdProgress));
                ctx.fillStyle = _withAlpha(color, 0.75);
                ctx.fillRect(bodyX + 1, yBottom - litH, bodyW - 2, litH);
            }
        }

        // 头部（判定线一侧）：与 Tap 同款扁平块
        if (yBottom > -50 && yBottom < this.canvasHeight) {
            this._drawNoteByStyle(x, yBottom, color, track);
        }

        // 尾部：较薄的扁平块
        if (yTop > -50 && yTop < this.canvasHeight) {
            const tailX = bodyX;
            const tailW = bodyW;
            ctx.fillStyle = _withAlpha(color, 0.55);
            ctx.beginPath();
            ctx.roundRect(tailX, yTop, tailW, tailH, radius);
            ctx.fill();
            ctx.strokeStyle = _withAlpha(color, 0.75);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(tailX + 0.5, yTop + 0.5, tailW - 1, tailH - 1, radius);
            ctx.stroke();
        }
    }

    /** Malody 皮肤长条：tex2=YnoteL 长条体，tex3=YnoteT 尾端，头部用音符贴图 */
    _drawSkinHoldBody(x, yTop, yBottom, isActive, holdProgress, track) {
        const ctx = this.ctx;
        const skin = this.skin;
        const s = this._skinScale;
        const noteH = skin.layout.noteHeight * s;
        const tailH = Math.min(noteH, Math.max(10, noteH * 0.6));
        const bodyTop = yTop + tailH;
        const bodyH = yBottom - bodyTop;

        if (bodyH > 0) {
            const bodyName = skin.spriteNameOf(skin.laneElement('note', track), ['tex2']) || 'YnoteL';
            // 底：半透明长条体
            skin.drawSprite(ctx, bodyName, x, bodyTop, CONFIG.trackWidth, bodyH, { alpha: 0.6 });
            // 按住中：已判定的部分再画一层全不透明，表示进度
            if (isActive && holdProgress > 0) {
                const litH = Math.max(2, bodyH * Math.min(1, holdProgress));
                ctx.save();
                ctx.beginPath();
                ctx.rect(x, yBottom - litH, CONFIG.trackWidth, litH);
                ctx.clip();
                skin.drawSprite(ctx, bodyName, x, bodyTop, CONFIG.trackWidth, bodyH, { alpha: 1 });
                ctx.restore();
            }
        }

        // 头部
        if (yBottom > -50 && yBottom < this.canvasHeight) {
            this._drawNoteByStyle(x, yBottom, '#947FFF', track);
        }

        // 尾巴
        if (yTop > -50 && yTop < this.canvasHeight) {
            const tailName = skin.spriteNameOf(skin.laneElement('note', track), ['tex3']) || 'YnoteT';
            skin.drawSprite(ctx, tailName, x, yTop, CONFIG.trackWidth, tailH, { alpha: 0.85 });
        }
    }

    _drawNoteByStyle(x, y, color, track = 0) {
        const skin = this.skin;
        if (skin && this.spritesReady) {
            const noteH = skin.layout.noteHeight * this._skinScale;
            const name = skin.spriteNameOf(skin.laneElement('note', track), ['tex']);
            if (name && skin.drawSprite(this.ctx, name, x, y + (24 - noteH) / 2, CONFIG.trackWidth, noteH)) return;
        }

        const ctx = this.ctx;
        const w = CONFIG.trackWidth - 6;
        const h = 24;
        const nx = x + 3;
        const radius = noteStyle === 'pixel' ? 0 : 3;

        // 扁平音符：纯色块 + 1px 描边，无渐变 / 无外发光 / 无高光
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(nx, y + 2, w, h, radius);
        ctx.fill();

        ctx.strokeStyle = 'rgba(10, 10, 16, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(nx + 0.5, y + 2.5, w - 1, h - 1, radius);
        ctx.stroke();
    }

    // ========== 倒计时（扁平） ==========
    /** @param {boolean} resumeMode true = 暂停恢复倒计时（数字略小并显示 READY 提示） */
    drawCountdown(secondsLeft, resumeMode = false) {
        if (secondsLeft <= 0) return;
        const ctx = this.ctx;
        const s = this._hudScale;
        const w = this.canvasWidth;
        const h = this.canvasHeight;
        const centerX = w / 2;
        const centerY = h * 0.46;
        const color = resumeMode ? '#69db7c' : this._accent;
        const radius = (resumeMode ? 44 : 56) * Math.max(0.85, s);
        const fontSize = (resumeMode ? 42 : 54) * Math.max(0.85, s);

        ctx.save();

        // 扁平：整屏实色压暗
        ctx.fillStyle = 'rgba(6, 6, 12, 0.62)';
        ctx.fillRect(0, 0, w, h);

        // 实色底板方块 + 1px 描边
        const box = radius + 22 * s;
        ctx.fillStyle = '#12121b';
        ctx.fillRect(centerX - box, centerY - box, box * 2, box * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.strokeRect(centerX - box + 0.5, centerY - box + 0.5, box * 2 - 1, box * 2 - 1);

        // 底环
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 4 * s;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.stroke();

        // 进度环：实色弧线，无发光
        const progress = Math.max(0, Math.min(1, 1 - (secondsLeft / (CONFIG.countdownDuration / 1000))));
        ctx.strokeStyle = color;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
        ctx.stroke();

        // 数字
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `800 ${fontSize}px ${HUD_MONO_STACK}`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(Math.ceil(secondsLeft).toString(), centerX, centerY + 2 * s);

        // 状态标签
        ctx.font = `700 ${10 * s}px ${HUD_FONT_STACK}`;
        ctx.fillStyle = FLAT_PALETTE.textDim;
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
            // 扁平：2px 实色竖线，无发光
            ctx.globalAlpha = l.alpha * 0.45;
            ctx.fillStyle = l.color;
            ctx.fillRect(Math.round(l.x) - 1, startY - l.height, 2, l.height);
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
        // 皮肤模式：粒子使用皮肤轨道色，保持整体配色统一
        const pColor = (this.skin && this.spritesReady) ? this.skin.laneColor(track) : color;
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count;
            const p = this._getParticle();
            p.x = cx; p.y = y;
            p.vx = Math.cos(angle) * speed;
            p.vy = Math.sin(angle) * speed;
            p.size = 8;
            p.color = pColor;
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
            // 扁平：小方块粒子
            const size = Math.max(2, Math.round(p.size * p.life));
            ctx.globalAlpha = p.life * 0.7;
            ctx.fillStyle = p.color;
            ctx.fillRect(Math.round(p.x - size / 2), Math.round(p.y - size / 2), size, size);
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

            // Malody 皮肤：COOL / GOOD / MISS 贴图
            if (this.skin && this.spritesReady) {
                const names = { PERFECT: 'Yjud-1', GREAT: 'Yjud-2', MISS: 'Yjud-3' };
                const spriteName = names[j.text] || 'Yjud-3';
                const lw = this.skin.layout.judgeWidth * this._skinScale * j.bounce;
                const lh = this.skin.layout.judgeHeight * this._skinScale * j.bounce;
                if (this.skin.drawSprite(ctx, spriteName, x - lw / 2, j.y - lh / 2, lw, lh, { alpha: j.alpha })) continue;
            }

            const isPerfect = j.text === 'PERFECT';
            const isGreat = j.text === 'GREAT';
            const color = isPerfect ? '#ffd43b' : isGreat ? '#69db7c' : '#ff6b6b';
            const baseSize = isPerfect ? 16 : isGreat ? 14 : 15;
            ctx.globalAlpha = j.alpha;
            ctx.font = `800 ${Math.round(baseSize * this._hudScale * j.bounce)}px ${HUD_FONT_STACK}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            // 扁平：纯色文字，无发光
            ctx.fillStyle = color;
            ctx.fillText(j.text, x, j.y);
            ctx.globalAlpha = 1.0;
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

        // ---- 低血量：实色边框呼吸（替代径向渐变暗角） ----
        const healthInitial = CONFIG.health.initial || 100;
        const healthRatio = Math.max(0, Math.min(1, gameState.health / healthInitial));
        if (healthRatio < 0.3) {
            const pulse = 0.35 + 0.35 * Math.sin(now / 170);
            ctx.strokeStyle = `rgba(255, 90, 96, ${(pulse * (1 - healthRatio / 0.3)).toFixed(3)})`;
            ctx.lineWidth = 3;
            ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
        }

        // ---- 左上：分数 / 准确率 / 判定统计 ----
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        ctx.font = `600 ${9.5 * s}px ${HUD_FONT_STACK}`;
        ctx.fillStyle = FLAT_PALETTE.textDim;
        ctx.fillText('SCORE', left, top);

        const scoreText = gameState.calculateFinalScore().finalScore.toLocaleString();
        ctx.font = `800 ${30 * s}px ${HUD_MONO_STACK}`;
        ctx.fillStyle = FLAT_PALETTE.text;
        ctx.fillText(scoreText, left, top + 13 * s);

        const acc = gameState.calculateTotalAcc();
        ctx.font = `600 ${9.5 * s}px ${HUD_FONT_STACK}`;
        ctx.fillStyle = FLAT_PALETTE.textDim;
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

        // ---- 右上：生命值（扁平条 + 1px 描边） ----
        const healthW = Math.min(210 * s, w * 0.34);
        const healthH = 8 * s;
        const hX = Math.round(w - this._safeRight - this._hudRightInset - healthW - 24 * s);
        const hY = Math.round(this._safeTop + (30 + perfAvoid) * s);
        const healthColor = healthRatio > 0.6 ? '#69db7c' : healthRatio > 0.3 ? '#ffd43b' : '#ff6b6b';

        ctx.textAlign = 'right';
        ctx.font = `600 ${9 * s}px ${HUD_FONT_STACK}`;
        ctx.fillStyle = FLAT_PALETTE.textDim;
        ctx.fillText('LIFE', hX + healthW, hY - 12 * s);

        ctx.fillStyle = '#1b1b26';
        ctx.fillRect(hX, hY, healthW, healthH);

        if (healthRatio > 0) {
            ctx.fillStyle = healthColor;
            ctx.fillRect(hX, hY, Math.round(healthW * healthRatio), healthH);
        }

        // 30% 危险刻度 + 1px 外框
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(hX + Math.round(healthW * 0.3), hY, 1, healthH);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.lineWidth = 1;
        ctx.strokeRect(hX + 0.5, hY + 0.5, healthW - 1, healthH - 1);

        // ---- 顶部中央：曲目信息 + 判定偏移条 ----
        if (this._songInfo && w >= 780) {
            const centerX = w / 2;
            const maxTitleW = Math.min(w * 0.3, 300);

            ctx.textAlign = 'center';
            ctx.font = `700 ${15 * s}px ${HUD_FONT_STACK}`;
            ctx.fillStyle = FLAT_PALETTE.text;
            ctx.fillText(this._fitText(this._songInfo.title || '', maxTitleW, ctx), centerX, top);

            const meta = [this._songInfo.artist, this._songInfo.difficulty].filter(Boolean).join('   ·   ');
            if (meta) {
                ctx.font = `600 ${9.5 * s}px ${HUD_FONT_STACK}`;
                ctx.fillStyle = FLAT_PALETTE.textDim;
                ctx.fillText(this._fitText(meta, maxTitleW, ctx), centerX, top + 20 * s);
            }

            this._drawTimingBar(centerX, top + 42 * s);
        }

        // ---- 中央连击：纯色数字，命中时放大 ----
        // 恢复倒计时期间隐藏连击，避免与 3-2-1 圆环重叠
        if (gameState.combo > 0 && !(gameState.resumeCountdownUntil > 0)) {
            const pop = 1 + this._comboPop * 0.16;
            const size = 44 * s * pop;
            const comboX = w / 2;
            const comboY = h * 0.34;
            const hotCombo = gameState.combo >= 50;

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            ctx.font = `800 ${size}px ${HUD_MONO_STACK}`;
            ctx.fillStyle = hotCombo ? '#ffd43b' : '#ffffff';
            ctx.fillText(gameState.combo, comboX, comboY);

            ctx.font = `700 ${10 * s}px ${HUD_FONT_STACK}`;
            ctx.fillStyle = hotCombo ? 'rgba(255, 212, 59, 0.75)' : FLAT_PALETTE.textDim;
            ctx.fillText('C O M B O', comboX, comboY + size * 0.62);

            ctx.textBaseline = 'top';
        }

        ctx.restore();
    }

    /** 顶部细进度条：扁平实色条 + 方形播放头 */
    _drawProgressBar(currentTime) {
        const ctx = this.ctx;
        const s = this._hudScale;
        const x = Math.round(this._safeLeft + 14 * s);
        const y = Math.round(this._safeTop + 4 * s);
        const w = Math.round(this.canvasWidth - this._safeLeft - this._safeRight - 28 * s);
        const barH = 3;

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

        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.fillRect(x, y, w, barH);

        if (p <= 0) return;

        // 已播放部分：单色实心条
        const playedW = Math.round(w * p);
        ctx.fillStyle = this._accent;
        ctx.fillRect(x, y, playedW, barH);

        // 播放头：2px 方形块
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + playedW - 1, y - 2, 2, barH + 4);
    }

    /** 判定偏移条：显示最近一次打击的 EARLY / LATE 偏差（扁平刻度） */
    _drawTimingBar(cx, y) {
        const lastAt = gameState.lastHitAt || 0;
        if (!lastAt) return;
        const age = performance.now() - lastAt;
        if (age > 1200) return;

        const ctx = this.ctx;
        const s = this._hudScale;
        const width = Math.round(150 * s);
        const barH = 4;
        const x = Math.round(cx - width / 2);
        const yTop = Math.round(y);
        const range = 120; // ±120ms 映射到两端

        ctx.globalAlpha = 0.4 + (1 - Math.min(1, age / 1200)) * 0.6;

        // 轨道底
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.fillRect(x, yTop, width, barH);

        // PERFECT 窗口：实色块
        const perfectW = Math.round((CONFIG.perfectWindow / range) * (width / 2));
        ctx.fillStyle = 'rgba(255, 212, 59, 0.45)';
        ctx.fillRect(Math.round(cx) - perfectW, yTop, perfectW * 2, barH);

        // 中心基准线
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.fillRect(Math.round(cx) - 1, yTop - 3, 2, barH + 6);

        // 偏移标记：方形块
        const offset = Math.max(-range, Math.min(range, gameState.lastHitOffset || 0));
        const markerX = Math.round(cx + (offset / range) * (width / 2));
        ctx.fillStyle = Math.abs(offset) <= CONFIG.perfectWindow ? '#ffd43b' : '#69db7c';
        ctx.fillRect(markerX - 2, yTop - 4, 4, barH + 8);

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
        const label = 'SPACE ×2 跳过前奏';
        const pillH = 30 * s;
        const pillY = cy - 92 * s;

        ctx.font = `600 ${11 * s}px ${HUD_FONT_STACK}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const pillW = ctx.measureText(label).width + 34 * s;

        // 扁平：纯色胶囊底 + 1px 描边，无发光
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#12121b';
        ctx.beginPath();
        ctx.roundRect(cx - pillW / 2, pillY, pillW, pillH, 4);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(cx - pillW / 2 + 0.5, pillY + 0.5, pillW - 1, pillH - 1, 4);
        ctx.stroke();

        // 文字：双击空格跳过前奏
        ctx.fillStyle = FLAT_PALETTE.text;
        ctx.fillText(label, cx, pillY + pillH / 2);

        ctx.restore();
    }

    // ========== 暂停遮罩 ==========
    drawPauseOverlay() {
        // 画面保持冻结可见，压暗由 #pauseOverlay DOM 的实色遮罩提供，
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