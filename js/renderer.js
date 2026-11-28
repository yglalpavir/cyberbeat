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

// 皮肤绘制取舍（Malody 皮肤只取赛道 / 音符 / 长条）：
//   useSkinJudgments=false  判定文字用本项目样式（PERFECT / GREAT / MISS），不画皮肤 Yjud 贴图
//   showBar=false           隐藏判定线（不画皮肤 Ybar4k）；接收器与判定位置仍保留
const SKIN_DRAW = {
    useSkinJudgments: false,
    showBar: false
};

// Hold 长条可读性：只改填充/描边/刻度的不透明度，不改长条起止点与命中几何。
// pending=未按下，active=按住中，missed=漏击或提前松开（保留到尾部离屏作为反馈）。
const HOLD_VIS = {
    pending: { body: 0.38, skin: 0.66, edge: 0.9, tail: 0.72, tick: 0.22, head: 0.55 },
    active: { body: 0.54, skin: 0.86, edge: 1.0, tail: 0.92, tick: 0.32, head: 0.9 },
    missed: { body: 0.16, skin: 0.4, edge: 0.45, tail: 0.32, tick: 0.12, head: 0 }
};
const HOLD_MISS_COLOR = '#ff6b6b';
// Hold 头部统一天空蓝：两种皮肤上都与轨道色 / 皮肤紫色拉开对比，Tap 仍用轨道色。
const HOLD_HEAD_COLOR = '#87ceeb';

// 触屏判定线按扣除安全区与拇指余量后的高度计算。
// 横屏拇指活动范围更短，判定线再往下放一点，手势区更靠近底部。
const MOBILE_HIT_FRACTION = 0.78;
const MOBILE_LANDSCAPE_HIT_FRACTION = 0.82;
const TOUCH_EDGE_PADDING = 16; // 外轨边缘放宽，横屏大面积留白仍不可触发打击
const TOUCH_SLIDE_SLOP = 6;    // 滑动越过轨道分界后再走几像素，避免在边界反复换轨

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

        // 游玩界面视觉状态
        this._laneFlash = [0, 0, 0, 0];        // 命中/漏击时的轨道闪光强度 0~1
        this._laneFlashColor = TRACK_COLORS.slice(); // 闪光颜色（命中=轨道色，漏击=红色）
        this._hitPulse = 0;                    // 判定线命中脉冲 0~1
        this._comboPop = 0;                    // 连击数字弹跳动画 0~1
        this._lastCombo = 0;
        this._songInfo = null;                 // { title, artist, difficulty }

        // 频谱律动 / 节拍边框 / 打击回弹（全部由谱面时钟与音频驱动，暂停即冻结）
        this._motionEnabled = true;
        this._eqBars = [];                     // 预计算的频谱柱几何
        this._bars = new Float32Array(0);
        this._prevBassRaw = 0;
        this._beat = 0;                        // 0~1 节拍脉冲
        this._lastOnsetAt = -Infinity;
        this._fallbackBeat = -1;
        this._countdownSecond = null;
        this._ringAge = [Infinity, Infinity, Infinity, Infinity];
        this._ringColor = TRACK_COLORS.slice();
        this._milestoneAge = Infinity;
        this._milestoneCombo = 0;
        this._displayScore = null;             // 缓动后的分数
        this._displayHealth = null;
        this._healthGhost = null;
        this._eqTop = 0;
        this._eqBottom = 0;
        this._setupMotionPreference();

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

    /** 跟随系统“减少动态效果”设置；Canvas 动画无法被 CSS 媒体查询覆盖，需要单独处理。 */
    _setupMotionPreference() {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        try {
            const query = window.matchMedia('(prefers-reduced-motion: reduce)');
            this._motionEnabled = !query.matches;
            const onChange = (event) => { this._motionEnabled = !event.matches; };
            if (typeof query.addEventListener === 'function') query.addEventListener('change', onChange);
            else if (typeof query.addListener === 'function') query.addListener(onChange);
        } catch (err) {
            this._motionEnabled = true;
        }
    }

    /** 设置帧间隔（毫秒），用于 delta-time 缩放视觉效果 */
    setFrameDelta(dt) {
        // 暂停/开场引导冻结时传入 0，绘制可继续但所有状态不推进
        this._dt = dt === 0 ? 0 : (dt < 8 ? 8 : (dt > 50 ? 50 : dt));
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

        // 判定线：取消底部 1234 按键后不再为触控栏预留高度，只避让安全区与拇指区
        const reservedBottom = this._safeBottom + 24;
        const availableHeight = Math.max(180, this.canvasHeight - reservedBottom);
        // 内置皮肤用 CONFIG.judgmentLineY；Malody 皮肤由脚本的 HITPOSITION 决定（越大越靠上）
        const desiredY = this.skin
            ? reservedBottom + (this.canvasHeight - reservedBottom) * this.skin.hitFraction
            : this.canvasHeight * CONFIG.judgmentLineY;
        const maxY = Math.max(120, availableHeight - 18);
        const clampY = y => Math.min(Math.max(availableHeight * 0.62, Math.min(y, maxY)), this.canvasHeight - 24);
        const touchY = fraction => clampY(Math.min(desiredY, reservedBottom + availableHeight * fraction));

        // 横屏判定线再下移一点；自动漏击的离屏阈值仍按原位置计算，不改变漏击时机。
        this._missJudgmentY = IS_TOUCH_DEVICE ? touchY(MOBILE_HIT_FRACTION) : clampY(desiredY);
        this._judgmentY = IS_TOUCH_DEVICE && this.canvasWidth > this.canvasHeight
            ? touchY(MOBILE_LANDSCAPE_HIT_FRACTION)
            : this._missJudgmentY;

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
        this._buildEqualizer();
    }

    /** 预计算底部频谱柱的位置与颜色，避免每帧测量布局。 */
    _buildEqualizer() {
        const count = Math.max(20, Math.min(56, Math.floor(this.canvasWidth / 26)));
        if (this._bars.length !== count) this._bars = new Float32Array(count);

        this._eqBars.length = 0;
        const side = Math.max(8, Math.round(10 * this._hudScale));
        const usable = Math.max(1, this.canvasWidth - side * 2);
        const step = usable / count;
        const barW = Math.max(2, Math.floor(step * 0.56));
        const positions = this.trackPositions;
        const fieldLeft = this.trackStartX - this._fieldPad;
        const fieldRight = fieldLeft + this._fieldWidth;

        for (let i = 0; i < count; i++) {
            const x = Math.round(side + i * step + (step - barW) / 2);
            const cx = x + barW / 2;
            let lane = -1;
            if (positions.length > 0 && cx >= fieldLeft && cx <= fieldRight) {
                for (let t = 0; t < positions.length; t++) {
                    if (cx >= positions[t].x && cx < positions[t].x + CONFIG.trackWidth) {
                        lane = t;
                        break;
                    }
                }
                if (lane < 0) lane = cx < positions[0].cx ? 0 : positions.length - 1;
            }
            this._eqBars.push({
                x,
                w: barW,
                color: lane >= 0 ? TRACK_COLORS[lane] : this._accent
            });
        }

        // 频谱只占用判定线以下的触控区，避免穿过音符下落阅读区
        this._eqTop = Math.round(this._judgmentY + 30 * this._hudScale);
        this._eqBottom = Math.round(this.canvasHeight - this._safeBottom - 8);
    }

    /** 画布 CSS 坐标 → 触控轨道；轨间缝隙从相邻轨道中心的中点分界。 */
    getTouchTrack(x, previousTrack = null) {
        const lanes = this.trackPositions;
        if (lanes.length === 0 || !Number.isFinite(x)) return null;

        const last = lanes.length - 1;
        const left = Math.max(this._safeLeft, lanes[0].x - TOUCH_EDGE_PADDING);
        const right = Math.min(this.canvasWidth - this._safeRight,
            lanes[last].x + CONFIG.trackWidth + TOUCH_EDGE_PADDING);
        if (x < left || x > right) return null;

        if (previousTrack !== null && lanes[previousTrack]) {
            const center = lanes[previousTrack].cx;
            const min = previousTrack === 0 ? left
                : (lanes[previousTrack - 1].cx + center) / 2 - TOUCH_SLIDE_SLOP;
            const max = previousTrack === last ? right
                : (center + lanes[previousTrack + 1].cx) / 2 + TOUCH_SLIDE_SLOP;
            if (x >= min && x <= max) return previousTrack;
        }

        for (let i = 0; i < last; i++) {
            if (x < (lanes[i].cx + lanes[i + 1].cx) / 2) return i;
        }
        return last;
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

    // ========== 律动状态（由 main.js 每帧调用，暂停时不推进） ==========
    /**
     * 推进频谱、节拍、打击回弹与 HUD 缓动。
     * 只读取游戏时钟与音频分析数据，不参与判定，也不会创造独立时间轴。
     * @param {number} currentTime 谱面时间（ms），倒计时期间为负
     */
    updateRhythm(currentTime) {
        const dt = this._dt;
        if (dt === 0) return;
        const targetScore = gameState.calculateFinalScore().finalScore || 0;
        const targetHealth = gameState.health || 0;

        // 连击弹跳与里程碑：放在这里而不是 drawHUD，暂停时才能真正冻结
        if (gameState.combo > this._lastCombo) {
            this._comboPop = 1;
            if (gameState.combo >= 50
                && Math.floor(gameState.combo / 50) > Math.floor(this._lastCombo / 50)) {
                this._milestoneCombo = Math.floor(gameState.combo / 50) * 50;
                this._milestoneAge = 0;
                this._triggerBeat();
            }
        }
        if (gameState.combo <= 0) this._comboPop = 0;
        this._lastCombo = gameState.combo;
        if (this._comboPop > 0) this._comboPop = Math.max(0, this._comboPop - 0.07 * (dt / 16.67));

        // 减少动态效果：保留判定与轨道闪光，关闭环境律动和数值缓动
        if (!this._motionEnabled) {
            this._comboPop = 0;
            this._lastCombo = gameState.combo;
            this._beat = 0;
            this._bars.fill(0);
            this._displayScore = targetScore;
            this._displayHealth = targetHealth;
            this._healthGhost = targetHealth;
            this._ringAge.fill(Infinity);
            this._milestoneAge = Infinity;
            return;
        }

        // 分数与血量缓动：只影响显示，暂停面板/结算仍用真实值
        if (this._displayScore === null) this._displayScore = targetScore;
        this._displayScore += (targetScore - this._displayScore) * (1 - Math.exp(-dt / 90));
        if (Math.abs(targetScore - this._displayScore) < 0.6) this._displayScore = targetScore;

        if (this._displayHealth === null) {
            this._displayHealth = targetHealth;
            this._healthGhost = targetHealth;
        }
        this._displayHealth += (targetHealth - this._displayHealth) * (1 - Math.exp(-dt / 65));
        if (Math.abs(targetHealth - this._displayHealth) < 0.05) this._displayHealth = targetHealth;

        if (this._healthGhost === null) this._healthGhost = targetHealth;
        if (targetHealth < this._healthGhost) {
            // 受伤残影：比主血条慢一拍回落，让扣血方向可读
            this._healthGhost += (targetHealth - this._healthGhost) * (1 - Math.exp(-dt / 360));
            if (this._healthGhost - targetHealth < 0.05) this._healthGhost = targetHealth;
        } else {
            this._healthGhost = targetHealth;
        }

        let data = null;
        if (currentTime >= 0 && typeof audioEngine !== 'undefined' && audioEngine
            && typeof audioEngine.getVisualizerData === 'function') {
            data = audioEngine.getVisualizerData();
        }

        if (data && data.length > 0) {
            const comp = (typeof audioEngine.visualizerGainComp === 'number')
                ? audioEngine.visualizerGainComp : 1;
            const n = this._bars.length;
            const binMax = Math.max(2, Math.floor(data.length * 0.72));

            for (let i = 0; i < n; i++) {
                // 对数感映射：低频占更多柱，高频铺开后段
                const pos = 1 + (binMax - 1) * Math.pow((i + 1) / n, 1.8);
                const idx = Math.min(data.length - 1, Math.max(0, Math.round(pos)));
                const raw = Math.min(1, (data[idx] / 255) * comp * 0.8);
                const target = 0.035 + Math.pow(raw, 0.85) * 0.965;
                const tau = target > this._bars[i] ? 55 : 210;
                this._bars[i] += (target - this._bars[i]) * (1 - Math.exp(-dt / tau));
            }

            let bassSum = 0;
            let bassCount = 0;
            const bassBins = Math.min(6, data.length - 1);
            for (let i = 1; i <= bassBins; i++) {
                bassSum += data[i];
                bassCount++;
            }
            const bassRaw = bassCount
                ? Math.min(1, (bassSum / bassCount / 255) * comp * 0.95) : 0;

            // 低频起音检测：鼓点落下时给轨道外框一次短脉冲
            if (bassRaw > 0.26 && bassRaw - this._prevBassRaw > 0.045
                && Math.abs(currentTime - this._lastOnsetAt) > 105) {
                this._triggerBeat();
                this._lastOnsetAt = currentTime;
            }
            this._prevBassRaw = bassRaw;
            this._fallbackBeat = -1;
        } else {
            // 没有可用频谱时（倒计时 / 浏览器不支持 analyser）用秒针或 BPM 生成呼吸
            const bpm = Math.max(30, Math.min(300, CONFIG.bpm || 120));
            const beatMs = 60000 / bpm;
            let energy;
            if (currentTime < 0) {
                const sec = Math.ceil(-currentTime / 1000);
                if (sec !== this._countdownSecond) {
                    this._countdownSecond = sec;
                    this._triggerBeat();
                }
                const frac = Math.max(0, Math.min(1, (-currentTime / 1000) % 1));
                energy = 0.22 + 0.5 * (1 - frac);
            } else {
                this._countdownSecond = null;
                // 无频谱时使用谱面时间做装饰性脉冲，不用于判定。
                const beatClock = currentTime;
                const beatIndex = Math.floor(beatClock / beatMs);
                if (beatIndex !== this._fallbackBeat) {
                    this._fallbackBeat = beatIndex;
                    this._triggerBeat();
                }
                const frac = (Math.max(0, beatClock) % beatMs) / beatMs;
                energy = 0.12 + 0.35 * Math.pow(1 - frac, 3);
            }

            // 合成频谱：中间高、两侧低，再叠加缓慢漂移，形状近似真实低频分布
            const n = this._bars.length;
            const drift = currentTime / 900;
            for (let i = 0; i < n; i++) {
                const center = 1 - Math.abs(i / Math.max(1, n - 1) - 0.5) * 2;
                const target = 0.05 + energy * 0.42 * center
                    + 0.04 * (0.5 + 0.5 * Math.sin(drift + i * 0.55));
                this._bars[i] += (target - this._bars[i]) * (1 - Math.exp(-dt / 90));
            }
        }

        // 节拍脉冲与外框高亮衰减
        this._beat = Math.max(0, this._beat - dt / 260);

        if (this._milestoneAge !== Infinity) {
            this._milestoneAge += dt;
            if (this._milestoneAge > 900) this._milestoneAge = Infinity;
        }
        for (let i = 0; i < this._ringAge.length; i++) {
            if (this._ringAge[i] !== Infinity) {
                this._ringAge[i] += dt;
                if (this._ringAge[i] > 320) this._ringAge[i] = Infinity;
            }
        }
    }

    _triggerBeat() {
        this._beat = 1;
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
            this._drawHitRings();
            return;
        }
        this._drawFlatTracks();
        this._drawHitRings();
    }

    /** Malody 皮肤：背景板 / 底部填充 / 按下列 / 接收器 / 判定线（键位列 Yhint 装饰层不绘制） */
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
        this._drawEqualizer();

        // 3. 键位列（Yhint1 / Yhint2）不绘制：这两张贴图的可见像素只有顶部的紫色横带与短条，
        //    铺满判定线以上后横带会贴在屏幕顶端，看起来像多出一条紫色判定线。
        //    它是纯装饰层，接收器与判定线仍完整标出轨道和判定位置。

        // 4. 按下列：白底贴图按轨道色着色，opacity 来自脚本（35%），铺满判定线以上
        for (let i = 0; i < positions.length; i++) {
            if (!gameState.pressedKeys.has(KEYS[i])) continue;
            skin.drawLaneSprite(ctx, 'press', i, positions[i].x, 0, trackW, jy, {
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

        // 6. 判定线：默认隐藏（SKIN_DRAW.showBar=false），只保留接收器标出判定位置
        if (SKIN_DRAW.showBar) {
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
        this._drawRhythmFrame(fieldX, fieldW);
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

        // 底部频谱：只铺在判定线以下，作为音乐可视化与触控区的环境层次
        this._drawEqualizer();

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

        this._drawRhythmFrame(fieldX, fieldW);
    }

    /** 判定线以下的实时频谱：扁平色块，按所在轨道取色。 */
    _drawEqualizer() {
        if (!this._motionEnabled || this._eqBars.length === 0) return;
        if (this._eqBottom - this._eqTop < 8) return;

        const ctx = this.ctx;
        const maxH = Math.max(4, (this._eqBottom - this._eqTop) * 0.84);
        const beat = this._beat;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
        ctx.fillRect(10, this._eqBottom, Math.max(0, this.canvasWidth - 20), 1);

        for (let i = 0; i < this._eqBars.length; i++) {
            const bar = this._eqBars[i];
            const v = this._bars[i] || 0;
            const barH = Math.max(2, Math.round(maxH * (0.06 + v * 0.94)));

            ctx.fillStyle = bar.color;
            ctx.globalAlpha = 0.06 + v * 0.2 + beat * 0.035;
            ctx.fillRect(bar.x, this._eqBottom - barH, bar.w, barH);

            // 柱顶加亮 2px，让频谱有明确的“峰”
            ctx.globalAlpha = 0.1 + v * 0.38;
            ctx.fillRect(bar.x, this._eqBottom - barH, bar.w, 2);
        }
        ctx.globalAlpha = 1;
    }

    /** 轨道四角的节拍框：低频起音时向外弹开，连击里程碑时闪白。 */
    _drawRhythmFrame(fieldX, fieldW) {
        const ctx = this.ctx;
        const pulse = this._motionEnabled ? this._beat : 0;
        const milestone = this._milestoneAge < 260
            ? 1 - this._milestoneAge / 260 : 0;
        const alpha = 0.14 + pulse * 0.42 + milestone * 0.25;
        const len = 12 + pulse * 10;
        const thick = 2;
        const x1 = Math.round(fieldX) + 1;
        const x2 = Math.round(fieldX + fieldW) - 1;
        const y1 = Math.round(this._safeTop + 8 * this._hudScale);
        const y2 = Math.round(this.canvasHeight - this._safeBottom - 8);

        ctx.fillStyle = milestone > 0.35 ? '#ffffff' : this._accent;
        ctx.globalAlpha = Math.min(0.85, alpha);
        // 左上
        ctx.fillRect(x1, y1, len, thick);
        ctx.fillRect(x1, y1, thick, len);
        // 右上
        ctx.fillRect(x2 - len, y1, len, thick);
        ctx.fillRect(x2 - thick, y1, thick, len);
        // 左下
        ctx.fillRect(x1, y2 - thick, len, thick);
        ctx.fillRect(x1, y2 - len, thick, len);
        // 右下
        ctx.fillRect(x2 - len, y2 - thick, len, thick);
        ctx.fillRect(x2 - thick, y2 - len, thick, len);
        ctx.globalAlpha = 1;
    }

    /** 命中回弹：判定线处扩散的扁平方形准星。 */
    _drawHitRings() {
        if (!this._motionEnabled) return;
        const ctx = this.ctx;
        const jy = this._judgmentY;
        for (let i = 0; i < this._ringAge.length; i++) {
            const age = this._ringAge[i];
            if (age === Infinity) continue;
            const t = Math.min(1, age / 320);
            const ease = 1 - Math.pow(1 - t, 3);
            const w = CONFIG.trackWidth * (0.38 + ease * 0.58);
            const h = 12 + ease * 34;
            const cx = this.trackPositions[i].cx;

            ctx.globalAlpha = (1 - t) * (1 - t) * 0.72;
            ctx.strokeStyle = this._ringColor[i];
            ctx.lineWidth = 2.2 * (1 - t) + 0.6;
            ctx.beginPath();
            ctx.roundRect(cx - w / 2, jy - h / 2, w, h, 3);
            ctx.stroke();

            // 向两侧飞出的短刻度，强调“打中了”
            const spread = Math.min(8 + ease * 26, (CONFIG.trackWidth - w) / 2);
            ctx.globalAlpha *= 0.8;
            ctx.fillStyle = this._ringColor[i];
            ctx.fillRect(cx - w / 2 - spread, jy - 1, 6, 2);
            ctx.fillRect(cx + w / 2 + spread - 6, jy - 1, 6, 2);
        }
        ctx.globalAlpha = 1;
    }

    // ========== 音符绘制 (可见性裁剪 + 精确几何提前终止) ==========
    drawNotes(currentTime) {
        const notes = gameState.notes;
        const noteCount = notes.length;
        if (noteCount === 0) { perfMonitor.visibleNotes = 0; perfMonitor.totalNotes = 0; return; }

        const positions = this.trackPositions;
        const canvasH = this.canvasHeight;
        const judgmentY = this._judgmentY;
        const missJudgmentY = this._missJudgmentY ?? judgmentY;
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

        // 已按住或按断的长条不受主循环的头部时间窗口限制。
        const firstDrawnTime = notes[startIdx] ? notes[startIdx].time : Infinity;
        for (const note of activeHolds) {
            if (note?.holdActive && note.endTime && note.time < firstDrawnTime &&
                this._drawTrackedHold(note, currentTime, judgmentY, speedMul, 'active')) visibleCount++;
        }
        if (this._missedHolds) {
            for (const note of this._missedHolds) {
                const headY = judgmentY + (currentTime - note.time) * speedMul / 1000;
                const tailY = judgmentY + (currentTime - note.endTime) * speedMul / 1000;
                if (headY < -50 || tailY > canvasH) this._missedHolds.delete(note);
                else if (this._drawTrackedHold(note, currentTime, judgmentY, speedMul, 'missed')) visibleCount++;
            }
        }

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
            // 已断长条由独立集合绘制，成功完成的长条不再显示。
            if (note.type === 'hold' && (note.missed || note.holdReleased || (note.hit && !note.holdActive))) continue;

            const offsetY = ((note.time - currentTime) / 1000) * speedMul;
            const rawY = judgmentY - offsetY;

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

                // Miss: 头部已过离屏阈值且未命中
                if (missJudgmentY - offsetY > canvasH + 100 && !note.hit) {
                    if (this._dt > 0 && !note.missed) {
                        note.missed = true;
                        note.hit = true;
                        note.holdActive = false;
                        activeHolds[note.track] = null;
                        gameState.miss++;
                        gameState.intervalStats.miss++;
                        gameState.combo = 0;
                        gameState.health = Math.max(0, gameState.health - lossOnMiss);
                        this.markHoldMiss(note, currentTime);
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
                const holdState = note.holdActive ? 'active' : 'pending';
                this._drawHoldBody(pos.x, visYTop, visYBot, colors[note.track], holdState, holdProgress, note.track, currentTime);
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

            // 已过离屏阈值 → Miss
            if (missJudgmentY - offsetY > canvasH + 100) {
                if (this._dt > 0 && !note.missed) {
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

    _drawTrackedHold(note, time, judgmentY, speed, state) {
        const headY = judgmentY + (time - note.time) * speed / 1000;
        const tailY = judgmentY + (time - note.endTime) * speed / 1000;
        if (headY < -50 || tailY > this.canvasHeight) return false;
        const start = note.startTime ?? note.time;
        const progress = state === 'active' && note.endTime > start
            ? Math.max(0, Math.min(1, (time - start) / (note.endTime - start))) : 0;
        note.y = headY;
        this._drawHoldBody(this.trackPositions[note.track].x, Math.max(-50, tailY), Math.min(this.canvasHeight, headY),
            TRACK_COLORS[note.track], state, progress, note.track, time, note._holdMissedAt);
        return true;
    }

    /**
     * 标记 Hold 漏击 / 提前松开。只改视觉状态，不改时间、判定或几何。
     * @param {Object} note
     * @param {number} [currentTime] 谱面时钟（ms），用于漏击反馈的短暂淡出
     */
    markHoldMiss(note, currentTime) {
        if (!note || note.type !== 'hold') return;
        note._holdMissedAt = Number.isFinite(currentTime) ? currentTime : 0;
        (this._missedHolds ??= new Set()).add(note);
    }

    /**
     * 绘制 Hold 长条体
     * 内置扁平：实色块 + 2px 描边；Malody 皮肤：YnoteL 长条体 + YnoteT 尾部
     * @param {'pending'|'active'|'missed'} state - 未按下 / 按住中 / 已漏击
     * @param {number} holdProgress - 按住进度 0~1（未按住时为 0）
     * @param {number} [track] - 轨道索引（皮肤按轨道取贴图）
     */
    _drawHoldBody(x, yTop, yBottom, color, state, holdProgress, track, currentTime, missedAt) {
        const skin = this.skin;
        if (skin && this.spritesReady) {
            this._drawSkinHoldBody(x, yTop, yBottom, state, holdProgress, track, currentTime, missedAt);
            return;
        }

        const ctx = this.ctx;
        const vis = HOLD_VIS[state] || HOLD_VIS.pending;
        const missed = state === 'missed';
        const active = state === 'active';
        const bodyColor = missed ? HOLD_MISS_COLOR : color;
        const missFade = missed && missedAt > 0
            ? Math.max(0.55, 1 - (currentTime - missedAt) / 700 * 0.45)
            : 1;
        const trackW = CONFIG.trackWidth;
        const bodyW = trackW - 8;
        const bodyX = x + 4;
        const tailH = 14;
        const bodyTop = yTop + tailH;
        const bodyHeight = yBottom - bodyTop;
        const radius = noteStyle === 'pixel' ? 1 : 3;

        if (bodyHeight > 0) {
            // 长条主体：pending/active/missed 三档明度，保证轨道底色上仍然可读
            ctx.fillStyle = _withAlpha(bodyColor, vis.body * missFade);
            ctx.fillRect(bodyX, bodyTop, bodyW, bodyHeight);

            // 左右 2px 描边：比旧版更清楚，但不改变长条宽度
            ctx.fillStyle = _withAlpha(bodyColor, vis.edge * missFade);
            ctx.fillRect(bodyX, bodyTop, 2, bodyHeight);
            ctx.fillRect(bodyX + bodyW - 2, bodyTop, 2, bodyHeight);

            // 按住进度：从判定线一侧向上生长的实色块
            if (active && holdProgress > 0) {
                const litH = Math.max(2, bodyHeight * Math.min(1, holdProgress));
                ctx.fillStyle = _withAlpha(color, 0.72);
                ctx.fillRect(bodyX + 2, yBottom - litH, bodyW - 4, litH);

                // 进度前沿：2px 白色亮线，和轨道色形成明确分界
                ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                ctx.fillRect(bodyX + 2, yBottom - litH, bodyW - 4, 2);
            }

            // 内部刻度：pending 静态、active 缓慢流动；missed 只留很淡的残影
            if (bodyHeight > 8) {
                const gap = 40;
                const flow = (this._motionEnabled && active)
                    ? (Math.max(0, currentTime) / 12) % gap
                    : 0;
                const end = Math.min(bodyHeight - 1, gap * 8);
                ctx.fillStyle = _withAlpha(bodyColor, vis.tick * missFade);
                for (let offset = flow; offset <= end; offset += gap) {
                    ctx.fillRect(bodyX + 2, bodyTop + offset, bodyW - 4, 1);
                }
            }
        }

        // 头部（判定线一侧）：与 Tap 同款扁平块；头部统一天空蓝，漏击后不再画头，只留下方断条
        if (!missed && yBottom > -50 && yBottom < this.canvasHeight) {
            this._drawNoteByStyle(x, yBottom, HOLD_HEAD_COLOR, track);
            // Hold 头部内侧的 2px 亮线：与 Tap 区分，不改变音符盒尺寸
            ctx.fillStyle = `rgba(255, 255, 255, ${vis.head})`;
            ctx.fillRect(x + 4, yBottom + 23, Math.max(1, trackW - 8), 2);
        }

        // 尾部：较薄的扁平块
        if (yTop > -50 && yTop < this.canvasHeight) {
            const tailX = bodyX;
            const tailW = bodyW;
            ctx.fillStyle = _withAlpha(bodyColor, vis.tail * missFade);
            ctx.beginPath();
            ctx.roundRect(tailX, yTop, tailW, tailH, radius);
            ctx.fill();
            ctx.strokeStyle = _withAlpha(bodyColor, Math.min(1, vis.tail + 0.18) * missFade);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(tailX + 0.5, yTop + 0.5, tailW - 1, tailH - 1, radius);
            ctx.stroke();
        }
    }

    /** Malody 皮肤长条：tex2=YnoteL 长条体，tex3=YnoteT 尾端，头部用音符贴图 */
    _drawSkinHoldBody(x, yTop, yBottom, state, holdProgress, track, currentTime, missedAt) {
        const ctx = this.ctx;
        const skin = this.skin;
        const s = this._skinScale;
        const vis = HOLD_VIS[state] || HOLD_VIS.pending;
        const missed = state === 'missed';
        const active = state === 'active';
        const noteH = skin.layout.noteHeight * s;
        const tailH = Math.min(noteH, Math.max(10, noteH * 0.6));
        const bodyTop = yTop + tailH;
        const bodyH = yBottom - bodyTop;
        const tint = missed ? HOLD_MISS_COLOR : null;
        const missFade = missed && missedAt > 0
            ? Math.max(0.55, 1 - (currentTime - missedAt) / 700 * 0.45)
            : 1;

        if (bodyH > 0) {
            const bodyName = skin.spriteNameOf(skin.laneElement('note', track), ['tex2']) || 'YnoteL';
            // 底：半透明长条体；missed 用红色 tint 明确“已断”
            const bodyOpts = { alpha: vis.skin * missFade };
            if (tint) bodyOpts.tint = tint;
            const bodyDrawn = skin.drawSprite(ctx, bodyName, x, bodyTop, CONFIG.trackWidth, bodyH, bodyOpts);
            if (!bodyDrawn) {
                ctx.fillStyle = _withAlpha(missed ? HOLD_MISS_COLOR : skin.laneColor(track), vis.body * missFade);
                ctx.fillRect(x, bodyTop, CONFIG.trackWidth, bodyH);
            }
            // 按住中：已判定的部分再画一层全不透明，表示进度
            if (active && holdProgress > 0) {
                const litH = Math.max(2, bodyH * Math.min(1, holdProgress));
                ctx.save();
                ctx.beginPath();
                ctx.rect(x, yBottom - litH, CONFIG.trackWidth, litH);
                ctx.clip();
                skin.drawSprite(ctx, bodyName, x, bodyTop, CONFIG.trackWidth, bodyH, { alpha: 1 });
                ctx.restore();
            }
            // 1px 外框：皮肤贴图本身可能和轨道同色，加一圈边界保证可读性
            ctx.strokeStyle = _withAlpha(missed ? HOLD_MISS_COLOR : skin.laneColor(track), (missed ? 0.5 : 0.8) * missFade);
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, bodyTop + 0.5, CONFIG.trackWidth - 1, bodyH - 1);
        }

        // 头部：统一天空蓝（皮肤音符贴图用 tint 着色），missed 不画头
        if (!missed && yBottom > -50 && yBottom < this.canvasHeight) {
            this._drawNoteByStyle(x, yBottom, HOLD_HEAD_COLOR, track, HOLD_HEAD_COLOR);
        }

        // 尾巴
        if (yTop > -50 && yTop < this.canvasHeight) {
            const tailName = skin.spriteNameOf(skin.laneElement('note', track), ['tex3']) || 'YnoteT';
            const tailOpts = { alpha: vis.tail * missFade };
            if (tint) tailOpts.tint = tint;
            const tailDrawn = skin.drawSprite(ctx, tailName, x, yTop, CONFIG.trackWidth, tailH, tailOpts);
            if (!tailDrawn) {
                ctx.fillStyle = _withAlpha(missed ? HOLD_MISS_COLOR : skin.laneColor(track), vis.tail * missFade);
                ctx.fillRect(x, yTop, CONFIG.trackWidth, tailH);
            }
        }
    }

    /**
     * 绘制音符头。
     * @param {string} color 扁平皮肤的填充色
     * @param {number} track 轨道索引（皮肤按轨道取贴图）
     * @param {string|null} skinTint 皮肤贴图的着色（null = 用贴图原色）
     */
    _drawNoteByStyle(x, y, color, track = 0, skinTint = null) {
        const skin = this.skin;
        if (skin && this.spritesReady) {
            const noteH = skin.layout.noteHeight * this._skinScale;
            const name = skin.spriteNameOf(skin.laneElement('note', track), ['tex']);
            const opts = skinTint ? { tint: skinTint } : undefined;
            if (name && skin.drawSprite(this.ctx, name, x, y + (24 - noteH) / 2, CONFIG.trackWidth, noteH, opts)) return;
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

        // 整秒切换：数字弹一下，同时从圆环向外扩散一圈细线
        const number = Math.ceil(secondsLeft);
        const tick = this._motionEnabled ? Math.max(0, 1 - (number - secondsLeft) / 0.2) : 0;
        if (tick > 0.015) {
            const spread = (1 - tick) * 36;
            ctx.globalAlpha = tick * 0.35;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius + spread, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        // 四角短框随整秒向外弹开，和数字同步
        const pop = tick * tick * tick;
        const corner = 10 + pop * 7;
        const offset = pop * 4;
        const c1 = centerX - box + 4 - offset;
        const c2 = centerX + box - 4 + offset;
        const r1 = centerY - box + 4 - offset;
        const r2 = centerY + box - 4 + offset;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.5 + pop * 0.4;
        ctx.fillRect(c1, r1, corner, 2);
        ctx.fillRect(c1, r1, 2, corner);
        ctx.fillRect(c2 - corner, r1, corner, 2);
        ctx.fillRect(c2 - 2, r1, 2, corner);
        ctx.fillRect(c1, r2 - 2, corner, 2);
        ctx.fillRect(c1, r2 - corner, 2, corner);
        ctx.fillRect(c2 - corner, r2 - 2, corner, 2);
        ctx.fillRect(c2 - 2, r2 - corner, 2, corner);
        ctx.globalAlpha = 1;

        // 数字：整秒瞬间放大后回落
        const numScale = 1 + pop * 0.18;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `800 ${fontSize * numScale}px ${HUD_MONO_STACK}`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(String(number), centerX, centerY + 2 * s);

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

        // 命中反馈：轨道光柱 + 判定线脉冲 + 方框回弹
        this._laneFlash[track] = 1;
        this._laneFlashColor[track] = TRACK_COLORS[track];
        this._hitPulse = 1;
        this._ringAge[track] = 0;
        this._ringColor[track] = TRACK_COLORS[track];
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

        // 漏击：轨道短暂泛红提示 + 红色方框回弹
        this._laneFlash[track] = 0.85;
        this._laneFlashColor[track] = '#ff6b6b';
        this._ringAge[track] = 0;
        this._ringColor[track] = '#ff6b6b';
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

            // Malody 皮肤判定贴图（默认关闭：判定文字统一用本项目样式）
            if (SKIN_DRAW.useSkinJudgments && this.skin && this.spritesReady) {
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
        const currentTime = Math.max(0, gameState.currentTime());

        const left = this._safeLeft + 26 * s;
        const top = this._safeTop + 22 * s;

        ctx.save();

        // ---- 顶部歌曲进度条 ----
        this._drawProgressBar(currentTime);

        // ---- 低血量：实色边框呼吸（替代径向渐变暗角） ----
        const healthInitial = CONFIG.health.initial || 100;
        const healthRatio = Math.max(0, Math.min(1, gameState.health / healthInitial));
        if (healthRatio < 0.3) {
            const pulse = this._motionEnabled ? 0.35 + 0.35 * Math.sin(currentTime / 170) : 0.45;
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

        const scoreText = Math.round(this._displayScore === null
            ? gameState.calculateFinalScore().finalScore
            : this._displayScore).toLocaleString();
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
        const hY = Math.round(this._safeTop + 30 * s);
        const healthColor = healthRatio > 0.6 ? '#69db7c' : healthRatio > 0.3 ? '#ffd43b' : '#ff6b6b';

        ctx.textAlign = 'right';
        ctx.font = `600 ${9 * s}px ${HUD_FONT_STACK}`;
        ctx.fillStyle = FLAT_PALETTE.textDim;
        ctx.fillText('LIFE', hX + healthW, hY - 12 * s);

        ctx.fillStyle = '#1b1b26';
        ctx.fillRect(hX, hY, healthW, healthH);

        const displayHealth = this._displayHealth === null ? gameState.health : this._displayHealth;
        const ghostHealth = this._healthGhost === null ? displayHealth : this._healthGhost;
        const displayRatio = Math.max(0, Math.min(1, displayHealth / healthInitial));
        const ghostRatio = Math.max(0, Math.min(1, ghostHealth / healthInitial));

        // 受伤残影：先画慢一拍的红条，再用当前血量盖住，留下红色尾巴
        if (ghostRatio > displayRatio + 0.001) {
            ctx.fillStyle = 'rgba(255, 107, 107, 0.55)';
            ctx.fillRect(hX, hY, Math.round(healthW * ghostRatio), healthH);
        }
        if (displayRatio > 0) {
            const displayW = Math.max(1, Math.round(healthW * displayRatio));
            ctx.fillStyle = healthColor;
            ctx.fillRect(hX, hY, displayW, healthH);
            // 血量前沿：节拍时轻微加亮
            ctx.fillStyle = `rgba(255, 255, 255, ${0.55 + this._beat * 0.3})`;
            ctx.fillRect(hX + displayW - 1, hY, 1, healthH);
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

        }
        if (!(gameState.resumeCountdownUntil > 0)) {
            const timingY = w >= 780 ? top + 46 * s : Math.max(top + 110 * s, h * 0.34 + 46 * s);
            this._drawTimingBar(w / 2, timingY, currentTime);
        }

        // ---- 中央连击：纯色数字，命中时放大 ----
        // 恢复倒计时期间隐藏连击，避免与 3-2-1 圆环重叠
        if (gameState.combo > 0 && !(gameState.resumeCountdownUntil > 0)) {
            const pop = 1 + (this._motionEnabled ? this._comboPop * 0.16 : 0);
            const size = 44 * s * pop;
            const comboX = w / 2;
            const comboY = h * 0.34;
            const hotCombo = gameState.combo >= 50;

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            ctx.font = `800 ${size}px ${HUD_MONO_STACK}`;
            ctx.fillStyle = hotCombo ? '#ffd43b' : '#ffffff';
            ctx.fillText(gameState.combo, comboX, comboY);
            this._drawTimingCues(comboX, comboY, ctx.measureText(String(gameState.combo)).width / 2, currentTime);

            ctx.font = `700 ${10 * s}px ${HUD_FONT_STACK}`;
            ctx.globalAlpha = 0.7 + (this._motionEnabled ? this._beat * 0.3 : 0);
            ctx.fillStyle = hotCombo ? '#ffd43b' : FLAT_PALETTE.textDim;
            ctx.fillText('C O M B O', comboX, comboY + size * 0.62);
            ctx.globalAlpha = 1;

            this._drawComboMilestone(comboX, comboY, size, s);

            ctx.textBaseline = 'top';
        }

        ctx.restore();
    }

    /** 连击里程碑：数字上下展开两条横线，不遮挡数字本身。 */
    _drawComboMilestone(cx, cy, size, s) {
        if (!this._motionEnabled || this._milestoneAge === Infinity) return;
        const t = Math.min(1, this._milestoneAge / 900);
        const ease = 1 - Math.pow(1 - t, 3);
        const ctx = this.ctx;
        const half = size * 0.65 + ease * 110;
        const y1 = cy - size * 0.62;
        const y2 = cy + size * 0.62;

        ctx.strokeStyle = '#ffd43b';
        ctx.lineWidth = 2;
        ctx.globalAlpha = (1 - t) * 0.45;
        ctx.beginPath();
        ctx.moveTo(cx - half, y1);
        ctx.lineTo(cx + half, y1);
        ctx.moveTo(cx - half, y2);
        ctx.lineTo(cx + half, y2);
        ctx.stroke();

        ctx.fillStyle = '#ffd43b';
        ctx.globalAlpha = (1 - t) * 0.75;
        ctx.fillRect(cx - half, y1 - 4, 2, 8);
        ctx.fillRect(cx + half - 2, y1 - 4, 2, 8);
        ctx.fillRect(cx - half, y2 - 4, 2, 8);
        ctx.fillRect(cx + half - 2, y2 - 4, 2, 8);

        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.font = `800 ${8.5 * s}px ${HUD_FONT_STACK}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`MILESTONE ×${this._milestoneCombo}`, cx, y1 - 7);
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = 1;
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

        // 播放头：2px 方形块，节拍时上下轻微伸展
        const head = this._motionEnabled ? this._beat : 0;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + playedW - 1, y - 2 - head, 2 + head * 2, barH + 4 + head * 2);
    }

    /** 以谱面时钟衰减；同一位置的近期命中会叠得更亮。 */
    _drawTimingBar(cx, y, time) {
        const hits = gameState.recentTimingHits(time);
        if (!hits.length) return;
        const ctx = this.ctx;
        const s = this._hudScale;
        const half = Math.round(88 * s);
        const perfect = Math.round(half * CONFIG.perfectWindow / CONFIG.greatWindow);
        const x = Math.round(cx);
        const cy = Math.round(y);
        ctx.save();
        ctx.fillStyle = '#10151e';
        ctx.fillRect(x - half - 8, cy - 9, half * 2 + 16, 28);
        ctx.fillStyle = '#263e55';
        ctx.fillRect(x - half, cy - 2, half - perfect, 5);
        ctx.fillStyle = '#655537';
        ctx.fillRect(x - perfect, cy - 2, perfect * 2, 5);
        ctx.fillStyle = '#553035';
        ctx.fillRect(x + perfect, cy - 2, half - perfect, 5);

        for (const { offset, time: at, isPerfect } of hits) {
            const age = Math.max(0, time - at);
            const marker = Math.round(x + offset / CONFIG.greatWindow * half);
            ctx.globalAlpha = 0.58 * (1 - age / 10000);
            ctx.fillStyle = isPerfect ? '#ffd779' : offset < 0 ? '#83caff' : '#ff9298';
            ctx.fillRect(marker - 1, cy - 6, 2, 13);
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#e9e5de';
        ctx.fillRect(x, cy - 8, 1, 3);
        ctx.font = `600 ${Math.max(9, 10 * s)}px ${HUD_MONO_STACK}`;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#83caff';
        ctx.fillText(`−${CONFIG.greatWindow}`, x - half, cy + 7);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#dad5ce';
        ctx.fillText('0 ms', x, cy + 7);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#ff9298';
        ctx.fillText(`+${CONFIG.greatWindow}`, x + half, cy + 7);
        ctx.restore();
    }

    _drawTimingCues(cx, cy, halfText, time) {
        const ctx = this.ctx;
        const s = this._hudScale;
        ctx.save();
        for (const side of ['early', 'late']) {
            const age = time - gameState.timingCueAt[side];
            if (age < 0 || age >= 350) continue;
            const sign = side === 'early' ? -1 : 1;
            const travel = this._motionEnabled ? Math.min(age / 100, 1) * 5 : 0;
            const x = cx + sign * (halfText + (14 + travel) * s);
            ctx.globalAlpha = this._motionEnabled ? Math.min(1, (350 - age) / 135) : 1;
            ctx.strokeStyle = sign < 0 ? '#83caff' : '#ff9298';
            ctx.lineWidth = 2.5 * s;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(x - sign * 3 * s, cy - 5 * s);
            ctx.lineTo(x + sign * 3 * s, cy);
            ctx.lineTo(x - sign * 3 * s, cy + 5 * s);
            ctx.stroke();
        }
        ctx.restore();
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
        if (!ui || !ui._canSkipIntro()) return;

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
    drawLineChart(historyData, options) {
        this.drawPerformanceChart(document.getElementById('lineChartCanvas'), historyData, options);
    }

    /** 区间柱看局部失误，金色线看累计准确率；动效只负责从左到右揭示数据。 */
    drawPerformanceChart(canvas, historyData = [], { animate = true } = {}) {
        const container = canvas?.parentElement;
        if (!container) return;
        cancelAnimationFrame(canvas._performanceFrame);
        const w = Math.max(1, container.clientWidth);
        const h = Math.max(1, container.clientHeight);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        const ctx = canvas.getContext('2d');
        const data = historyData.filter(d => Number.isFinite(Number(d.totalAcc)));
        const compact = h < 120;
        const box = { left: compact ? 34 : 44, top: compact ? 30 : 42, right: 10, bottom: compact ? 17 : 22 };
        const chartW = Math.max(1, w - box.left - box.right);
        const chartH = Math.max(1, h - box.top - box.bottom);
        const values = data.flatMap(d => [Number(d.totalAcc), d.notes === 0 ? null : Number(d.intervalAcc)])
            .filter(Number.isFinite);
        const yMin = values.length ? Math.max(0, Math.floor((Math.min(...values) - 4) / 5) * 5) : 0;
        const yMax = 100;
        const y = value => box.top + chartH * (1 - (value - yMin) / Math.max(1, yMax - yMin));
        const x = i => box.left + (data.length > 1 ? i * chartW / (data.length - 1) : chartW / 2);
        const final = data.at(-1)?.totalAcc ?? 0;
        const low = data.reduce((min, d) => Math.min(min, Number(d.totalAcc)), 100);
        const motion = animate && this._motionEnabled && data.length > 1;
        const start = performance.now();

        const draw = now => {
            const t = motion ? Math.min(1, (now - start) / 720) : 1;
            const p = 1 - Math.pow(1 - t, 3);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = '#11171e';
            ctx.fillRect(0, 0, w, h);
            ctx.font = `700 ${compact ? 9 : 10}px ${HUD_MONO_STACK}`;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'right';
            for (const tick of this._generateYTicks(yMin, yMax)) {
                const ty = y(tick);
                ctx.fillStyle = tick === 100 ? '#f4cf7b' : '#7e8b96';
                ctx.fillText(`${Math.round(tick)}`, box.left - 7, ty);
                ctx.fillStyle = tick === 100 ? '#4d4637' : '#25303a';
                ctx.fillRect(box.left, Math.round(ty), chartW, 1);
            }
            if (!data.length) {
                ctx.textAlign = 'center';
                ctx.fillStyle = '#8f9aa4';
                ctx.fillText('NO TIMELINE DATA', w / 2, box.top + chartH / 2);
                return;
            }
            const reveal = box.left + chartW * p;
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, reveal + 1, h);
            ctx.clip();
            const barW = Math.max(2, Math.min(9, chartW / Math.max(1, data.length) * .48));
            data.forEach((d, i) => {
                if (d.notes === 0) return;
                const value = Number(d.intervalAcc) || 0;
                const top = y(value);
                ctx.fillStyle = value >= 92 ? '#665c43' : value >= 80 ? '#365d68' : '#764348';
                ctx.fillRect(Math.round(x(i) - barW / 2), top, barW, box.top + chartH - top);
            });
            ctx.strokeStyle = '#f4cf7b';
            ctx.lineWidth = compact ? 2 : 2.5;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            data.forEach((d, i) => i ? ctx.lineTo(x(i), y(d.totalAcc)) : ctx.moveTo(x(i), y(d.totalAcc)));
            ctx.stroke();
            ctx.restore();
            const headIndex = Math.min(data.length - 1, Math.floor(p * (data.length - 1)));
            ctx.fillStyle = '#f4eddf';
            ctx.fillRect(Math.round(x(headIndex) - 2), Math.round(y(data[headIndex].totalAcc) - 2), 4, 4);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.font = `800 ${compact ? 10 : 11}px ${HUD_MONO_STACK}`;
            ctx.fillStyle = '#f4eddf';
            ctx.fillText(`FINAL ${Number(final).toFixed(2)}%`, box.left, compact ? 9 : 13);
            ctx.textAlign = 'right';
            ctx.fillStyle = '#9ba7b1';
            ctx.fillText(`LOW ${low.toFixed(2)}%`, w - box.right, compact ? 9 : 13);
            ctx.textBaseline = 'alphabetic';
            ctx.textAlign = 'left';
            ctx.fillStyle = '#7e8b96';
            ctx.font = `600 ${compact ? 8 : 9}px ${HUD_MONO_STACK}`;
            ctx.fillText('0s', box.left, h - 5);
            ctx.textAlign = 'right';
            ctx.fillText(`${Math.round((data.at(-1).time || 0) / 1000)}s`, w - box.right, h - 5);
            if (t < 1) canvas._performanceFrame = requestAnimationFrame(draw);
        };
        draw(start);
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
        this._missedHolds?.clear();
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

        // 律动：清空频谱余量、打击回弹与缓动值，重开时不带上一局残影
        this._beat = 0;
        this._prevBassRaw = 0;
        this._fallbackBeat = -1;
        this._countdownSecond = null;
        this._lastOnsetAt = -Infinity;
        this._bars.fill(0);
        this._ringAge.fill(Infinity);
        this._ringColor = TRACK_COLORS.slice();
        this._milestoneAge = Infinity;
        this._milestoneCombo = 0;
        this._displayScore = null;
        this._displayHealth = null;
        this._healthGhost = null;
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