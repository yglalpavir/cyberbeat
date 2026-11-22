// ==================== Malody V 皮肤加载器 ====================
// 支持 Malody V 4.x 的 .mui 皮肤脚本（key 模式脚本 + base.mui）
// 与 TexturePacker 图集（.plist + .png），按 Malody 的图元定义绘制游玩界面。
//
// 坐标系统说明：
//   - 脚本里的 size / pos 使用「设计单位」；本皮肤 4K 轨道 = 100 宽、间距 5、整块 420，
//     判定线高度由 @define HITPOSITION 决定（设计单位，1 单位 ≈ 1/900 屏高）。
//   - 图集里的图元可能被旋转 90° 存储，加载时按 plist 的 rotated 标记还原，
//     并用像素覆盖率自动纠正个别标记错误的图元。

const SKIN_DEFAULT_DIR = 'assets/skins/yuxen';
const SKIN_DEFAULT_SCRIPT = 'script-key-4K.mui';
const SKIN_ATLAS_ROTATE_DIR = -1;   // 图集旋转还原方向：-1 = 逆时针 90°

/**
 * 解析 Apple plist（XML）为 JS 对象
 */
function parsePlist(text) {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    const root = doc.querySelector('plist');
    if (!root || !root.firstElementChild) throw new Error('plist: 未找到根节点');
    return plistNodeToValue(root.firstElementChild);
}

function plistNodeToValue(node) {
    switch (node.tagName) {
        case 'dict': {
            const obj = {};
            const kids = Array.from(node.children);
            for (let i = 0; i + 1 < kids.length; i += 2) {
                obj[kids[i].textContent.trim()] = plistNodeToValue(kids[i + 1]);
            }
            return obj;
        }
        case 'array':
            return Array.from(node.children).map(plistNodeToValue);
        case 'true': return true;
        case 'false': return false;
        case 'integer': return parseInt(node.textContent, 10);
        case 'real': return parseFloat(node.textContent);
        case 'string':
        default:
            return node.textContent;
    }
}

/** 解析 "{{x,y},{w,h}}" → {x,y,w,h} */
function parseFrameRect(str) {
    const m = String(str).match(/\{\{\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\}\s*,\s*\{\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\}\s*\}/);
    if (!m) return null;
    return { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
}

/** 简单坐标表达式求值：支持 "50%-157.5"、"100%+25"、"420+40"、"{HITPOSITION}-25"、"-55" */
function evalSkinExpr(expr, base, defines) {
    if (expr === undefined || expr === null) return 0;
    const raw = String(expr)
        .replace(/\{(\w+)\}/g, (m, key) => String(defines && defines[key] !== undefined ? defines[key] : 0))
        .replace(/\s+/g, '');
    const parts = raw.match(/[+-]?[^+-]+/g) || [];
    let total = 0;
    for (const part of parts) {
        const sign = part.startsWith('-') ? -1 : 1;
        const token = part.replace(/^[+-]/, '');
        let value = 0;
        if (token.endsWith('%')) value = (parseFloat(token) / 100) * base;
        else value = parseFloat(token);
        if (!Number.isFinite(value)) value = 0;
        total += sign * value;
    }
    return total;
}

/** 展开 Malody 元素选择器：note-[1-4] / note-[1,3,5,7] / press-[4] */
function expandSkinElementName(name) {
    const m = name.match(/^(.*?)-\[(.+)\]$/);
    if (!m) return [{ name, index: 0 }];
    const base = m[1];
    const out = [];
    for (const part of m[2].split(',')) {
        const seg = part.trim();
        const range = seg.match(/^(\d+)\s*-\s*(\d+)$/);
        if (range) {
            const a = +range[1];
            const b = +range[2];
            for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push({ name: `${base}-${i}`, index: i });
        } else if (/^\d+$/.test(seg)) {
            out.push({ name: `${base}-${+seg}`, index: +seg });
        }
    }
    return out.length ? out : [{ name, index: 0 }];
}

/**
 * 解析 .mui 文本
 * @returns {{ elements: Map<string, Object>, defines: Object }}
 */
function parseSkinScript(text) {
    const elements = new Map();
    const defines = {};
    let current = null;

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/\t/g, '    ');
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        if (trimmed.startsWith('@define ')) {
            const m = trimmed.match(/^@define\s+(\S+)\s+(.+)$/);
            if (m) defines[m[1]] = parseFloat(m[2]);
            continue;
        }
        if (trimmed.startsWith('@')) continue;   // @version / @include / @texpack

        const indent = line.length - line.trimStart().length;
        if (indent === 0 && !trimmed.includes('=')) {
            current = expandSkinElementName(trimmed);
            continue;
        }

        const eq = trimmed.indexOf('=');
        if (eq <= 0 || !current) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();

        for (const item of current) {
            let el = elements.get(item.name);
            if (!el) { el = {}; elements.set(item.name, el); }
            if (item.index) el.__index = item.index;
            el[key] = value;
        }
    }
    return { elements, defines };
}

class MalodySkin {
    constructor(dir) {
        this.dir = dir.replace(/\/+$/, '');
        this.elements = new Map();
        this.defines = {};
        this.frames = new Map();     // 精灵名（无扩展名）→ {x,y,w,h,rotated}
        this.sprites = new Map();    // 精灵名 → {canvas,w,h}
        this.extImages = new Map();  // 文件名 → HTMLImageElement
        this.tinted = new Map();     // 缓存着色精灵
        this.atlas = null;
        this.atlasData = null;
        this.atlasMeta = null;
        this.hitPosition = 72.5;
        this.laneCount = 4;

        // 由脚本推导的布局（设计单位）
        this.layout = {
            laneWidth: 100,
            laneGap: 5,
            fieldWidth: 420,
            noteHeight: 50,
            keyHeight: 300,
            pressHeight: 400,
            barWidth: 460,
            barHeight: 5
        };
    }

    // ==================== 加载 ====================

    /**
     * 载入皮肤目录
     * @param {string} dir 皮肤目录（相对页面）
     * @param {{script?: string, atlas?: string, plist?: string}} [opts]
     */
    static async load(dir = SKIN_DEFAULT_DIR, opts = {}) {
        const skin = new MalodySkin(dir);
        const scriptName = opts.script || SKIN_DEFAULT_SCRIPT;
        const atlasName = opts.atlas || 'Yassets';
        const plistName = opts.plist || 'Yassets.plist';

        // 1. 图集与图集描述
        const [plistText, atlasImg] = await Promise.all([
            MalodySkin._fetchText(`${skin.dir}/${plistName}`),
            MalodySkin._loadImage(`${skin.dir}/${atlasName}.png`)
        ]);
        skin._parseAtlas(plistText, atlasImg);

        // 2. 皮肤脚本（含 @include）
        const scriptText = await MalodySkin._fetchText(`${skin.dir}/${scriptName}`);
        await skin._parseScriptWithIncludes(scriptText);

        // 3. 推导布局与判定线
        skin._deriveLayout();
        return skin;
    }

    static async _fetchText(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`皮肤资源加载失败：${url} (HTTP ${res.status})`);
        return res.text();
    }

    static _loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`皮肤图片加载失败：${url}`));
            img.src = url;
        });
    }

    _parseAtlas(plistText, atlasImg) {
        const plist = parsePlist(plistText);
        this.atlas = atlasImg;
        this.atlasMeta = plist.metadata || null;
        const frames = plist.frames || {};
        for (const name of Object.keys(frames)) {
            const rect = parseFrameRect(frames[name].frame);
            if (!rect) continue;
            this.frames.set(name.replace(/\.(png|jpg|jpeg)$/i, ''), {
                x: rect.x, y: rect.y, w: rect.w, h: rect.h,
                rotated: frames[name].rotated === true
            });
        }
        // 图集像素数据（用于识别图元真实朝向）
        const canvas = document.createElement('canvas');
        canvas.width = atlasImg.naturalWidth;
        canvas.height = atlasImg.naturalHeight;
        const g = canvas.getContext('2d');
        g.drawImage(atlasImg, 0, 0);
        this._atlasPixels = g.getImageData(0, 0, canvas.width, canvas.height);
    }

    async _parseScriptWithIncludes(text, depth = 0) {
        if (depth > 4) return;
        for (const rawLine of text.split(/\r?\n/)) {
            const m = rawLine.trim().match(/^@include\s+(\S+\.mui)$/i);
            if (!m) continue;
            const included = await MalodySkin._fetchText(`${this.dir}/${m[1]}`);
            await this._parseScriptWithIncludes(included, depth + 1);
        }
        const { elements, defines } = parseSkinScript(text);
        for (const [name, props] of elements) {
            const prev = this.elements.get(name);
            this.elements.set(name, prev ? { ...prev, ...props } : props);
        }
        Object.assign(this.defines, defines);
    }

    _deriveLayout() {
        const defs = this.defines;
        const noteEl = this.elements.get('note-1');
        const bgEl = this.elements.get('_bg');
        const barEl = this.elements.get('bar');
        const keyEl = this.elements.get('key-1');
        const pressEl = this.elements.get('press-1');

        this.hitPosition = Number.isFinite(defs.HITPOSITION) ? defs.HITPOSITION : 72.5;
        this.laneCount = Math.max(4, this._countLanes('note'));

        const sizeOf = (el) => {
            if (!el || !el.size) return null;
            const [wx, wy] = el.size.split(',');
            return {
                x: evalSkinExpr(wx, 1000, defs),
                y: evalSkinExpr(wy, 900, defs)
            };
        };
        const noteSize = sizeOf(noteEl);
        const bgSize = sizeOf(bgEl);
        const barSize = sizeOf(barEl);
        const keySize = sizeOf(keyEl);
        const pressSize = sizeOf(pressEl);

        // 轨道步进：pos 里的 $step（如 50%-157.5$105）或图元宽度 + 间距
        let step = 0;
        if (noteEl && noteEl.pos) {
            const xPart = noteEl.pos.split(',')[0];
            const dollar = xPart.split('$');
            if (dollar.length > 1) step = evalSkinExpr(dollar[1], 1600, defs);
        }
        const laneWidth = noteSize ? noteSize.x : 100;
        if (!step) step = laneWidth + 5;
        const laneGap = Math.max(0, step - laneWidth);

        this.layout.laneWidth = laneWidth;
        this.layout.laneGap = laneGap;
        this.layout.noteHeight = noteSize ? noteSize.y : 50;
        this.layout.fieldWidth = bgSize ? bgSize.x : laneWidth * this.laneCount + laneGap * (this.laneCount - 1);
        this.layout.barWidth = barSize ? barSize.x : this.layout.fieldWidth + 40;
        this.layout.barHeight = barSize ? barSize.y : 5;
        this.layout.keyHeight = keySize ? keySize.y : 300;
        this.layout.pressHeight = pressSize ? pressSize.y : 400;

        // 判定字尺寸（judge-1: size=175,42）
        const judgeEl = this.elements.get('judge-1');
        const judgeSize = sizeOf(judgeEl);
        this.layout.judgeWidth = judgeSize ? judgeSize.x : 175;
        this.layout.judgeHeight = judgeSize ? judgeSize.y : 42;

        // 判定线：HITPOSITION 越大越靠上（Malody 以 900 单位屏高为参照）
        const bottomUnits = this.hitPosition + 25;
        this.hitFraction = Math.min(0.95, Math.max(0.55, 1 - bottomUnits / 900));
    }

    _countLanes(prefix) {
        let max = 0;
        for (const name of this.elements.keys()) {
            const m = name.match(new RegExp(`^${prefix}-(\\d+)$`));
            if (m) max = Math.max(max, +m[1]);
        }
        return max;
    }

    // ==================== 图元 ====================

    /** 按 plist 标记确定图元朝向；仅当该朝向的裁剪区域几乎为空时才翻转（修正个别标记错误的图元） */
    _resolveSprite(name) {
        if (this.sprites.has(name)) return this.sprites.get(name);

        const frame = this.frames.get(name);
        if (frame) {
            const srcW = frame.w;
            const srcH = frame.h;
            // 两种候选：图集里旋转存储（占位 h×w）或未旋转（占位 w×h）
            const rotCoverage = this._coverage(frame.x, frame.y, srcH, srcW);
            const plainCoverage = this._coverage(frame.x, frame.y, srcW, srcH);

            let useRotated = frame.rotated;
            if (frame.rotated && rotCoverage < 0.01 && plainCoverage > 0.05) useRotated = false;
            if (!frame.rotated && plainCoverage < 0.01 && rotCoverage > 0.05) useRotated = true;

            const sprite = {
                canvas: this._extractFromAtlas(frame, srcW, srcH, useRotated),
                w: srcW,
                h: srcH,
                rotated: useRotated
            };
            this.sprites.set(name, sprite);
            return sprite;
        }

        // 图集里没有 → 当作目录下的独立贴图
        const external = this.extImages.get(name);
        if (external) {
            const canvas = document.createElement('canvas');
            canvas.width = external.naturalWidth;
            canvas.height = external.naturalHeight;
            canvas.getContext('2d').drawImage(external, 0, 0);
            const sprite = { canvas, w: canvas.width, h: canvas.height, rotated: false };
            this.sprites.set(name, sprite);
            return sprite;
        }
        return null;
    }

    /** 取样统计 rect 内的不透明占比（步长 2px，足够区分图元与空白） */
    _coverage(x, y, w, h) {
        const data = this._atlasPixels;
        if (!data) return 0;
        const W = data.width;
        const H = data.height;
        if (x < 0 || y < 0 || x + w > W || y + h > H || w <= 0 || h <= 0) return 0;
        const px = data.data;
        let hit = 0;
        let total = 0;
        for (let yy = y; yy < y + h; yy += 2) {
            for (let xx = x; xx < x + w; xx += 2) {
                total++;
                if (px[(yy * W + xx) * 4 + 3] > 8) hit++;
            }
        }
        return total ? hit / total : 0;
    }

    _extractFromAtlas(frame, srcW, srcH, rotated) {
        const canvas = document.createElement('canvas');
        canvas.width = srcW;
        canvas.height = srcH;
        const g = canvas.getContext('2d');
        g.imageSmoothingEnabled = true;
        if (rotated) {
            // 图集里图元被旋转 90° 存储：还原后再缩放绘制
            g.translate(srcW / 2, srcH / 2);
            g.rotate(SKIN_ATLAS_ROTATE_DIR * Math.PI / 2);
            g.drawImage(this.atlas, frame.x, frame.y, srcH, srcW, -srcH / 2, -srcW / 2, srcH, srcW);
        } else {
            g.drawImage(this.atlas, frame.x, frame.y, srcW, srcH, 0, 0, srcW, srcH);
        }
        return canvas;
    }

    /** 载入皮肤目录下的独立贴图（tex2/tex3 等不在图集里的图元） */
    async preloadExternal(filenames) {
        const jobs = [];
        for (const file of filenames) {
            if (!file || this.extImages.has(file) || this.frames.has(file.replace(/\.(png|jpg|jpeg)$/i, ''))) continue;
            jobs.push(MalodySkin._loadImage(`${this.dir}/${file}`).then((img) => {
                this.extImages.set(file, img);
                this.extImages.set(file.replace(/\.(png|jpg|jpeg)$/i, ''), img);
            }).catch(() => { /* 单张贴图缺失不阻塞皮肤 */ }));
        }
        await Promise.all(jobs);
    }

    /** 取元素定义（含按选择器展开的下标） */
    element(name) {
        return this.elements.get(name) || null;
    }

    /** 取某条轨道的元素（name=note/key/press/_bottom/_receptors） */
    laneElement(name, trackIndex) {
        return this.element(`${name}-${trackIndex + 1}`) || this.element(`${name}-1`);
    }

    /** 元素贴图名（tex / frame / tex2 中的第一个可用项） */
    spriteNameOf(el, keys = ['tex', 'frame', 'tex2', 'tex3']) {
        if (!el) return null;
        for (const key of keys) {
            const spec = el[key];
            if (!spec) continue;
            const [base, range] = spec.split('/');
            if (range) {
                const first = range.split('-')[0];
                return `${base}-${first}`.replace(/\.(png|jpg|jpeg)$/i, '');
            }
            return base.replace(/\.(png|jpg|jpeg)$/i, '');
        }
        return null;
    }

    /** 元素颜色（#RRGGBB） */
    colorOf(el, fallback = '#947FFF') {
        if (el && el.color && /^#[0-9a-fA-F]{6}$/.test(el.color)) return el.color;
        return fallback;
    }

    /** 皮肤主色（用于 HUD 强调色） */
    get accentColor() {
        const press = this.element('press-1');
        return this.colorOf(press, '#947FFF');
    }

    /** 轨道色（用于粒子等特效） */
    laneColor(trackIndex) {
        const el = this.laneElement('press', trackIndex);
        return this.colorOf(el, trackIndex % 2 === 0 ? '#947FFF' : '#C9BFFF');
    }

    /** 判断/生成着色版本（白底贴图 + 颜色） */
    tintedSprite(name, color) {
        const key = `${name}|${color}`;
        if (this.tinted.has(key)) return this.tinted.get(key);
        const sprite = this._resolveSprite(name);
        if (!sprite) return null;
        const canvas = document.createElement('canvas');
        canvas.width = sprite.canvas.width;
        canvas.height = sprite.canvas.height;
        const g = canvas.getContext('2d');
        g.drawImage(sprite.canvas, 0, 0);
        g.globalCompositeOperation = 'source-in';
        g.fillStyle = color;
        g.fillRect(0, 0, canvas.width, canvas.height);
        const out = { canvas, w: sprite.w, h: sprite.h };
        this.tinted.set(key, out);
        return out;
    }

    /** 是否所有关键图元都已就绪 */
    get isPlayfieldReady() {
        return !!(this._resolveSprite('Ynote1') || this._resolveSprite('Ynote2'));
    }

    /**
     * 绘制图元
     * @param {CanvasRenderingContext2D} ctx
     * @param {string} name 精灵名
     * @param {number} x 目标左上角 X
     * @param {number} y 目标左上角 Y
     * @param {number} w 目标宽
     * @param {number} h 目标高
     * @param {{alpha?: number, tint?: string, smooth?: boolean}} [opts]
     */
    drawSprite(ctx, name, x, y, w, h, opts = {}) {
        if (!name || w <= 0 || h <= 0) return false;
        const sprite = opts.tint ? this.tintedSprite(name, opts.tint) : this._resolveSprite(name);
        if (!sprite) return false;
        const alpha = opts.alpha === undefined ? 1 : opts.alpha;
        if (alpha <= 0) return false;
        const prevAlpha = ctx.globalAlpha;
        const prevSmooth = ctx.imageSmoothingEnabled;
        ctx.globalAlpha = prevAlpha * alpha;
        ctx.imageSmoothingEnabled = opts.smooth !== false;
        ctx.drawImage(sprite.canvas, x, y, w, h);
        ctx.globalAlpha = prevAlpha;
        ctx.imageSmoothingEnabled = prevSmooth;
        return true;
    }

    /** 绘制轨道元素的贴图（自动按轨道取 tex） */
    drawLaneSprite(ctx, elementName, trackIndex, x, y, w, h, opts = {}) {
        const el = this.laneElement(elementName, trackIndex);
        const spriteName = this.spriteNameOf(el, opts.keys || ['tex', 'frame', 'tex2', 'tex3']);
        if (!spriteName) return false;
        const opts2 = { ...opts };
        if (opts2.useElementColor && el && el.color) opts2.tint = el.color;
        if (opts2.useElementOpacity && el && el.opacity) {
            const op = parseFloat(String(el.opacity).replace('%', ''));
            if (Number.isFinite(op)) opts2.alpha = (opts2.alpha === undefined ? 1 : opts2.alpha) * (op / 100);
        }
        return this.drawSprite(ctx, spriteName, x, y, w, h, opts2);
    }
}

// ==================== 全局皮肤状态 ====================

let skinMode = 'builtin';       // 'builtin' | 'malody'
let activeSkin = null;          // MalodySkin 实例
let _skinLoading = null;

/** 当前皮肤（未启用时返回 null） */
function getActiveSkin() {
    return skinMode === 'malody' ? activeSkin : null;
}

/** 载入 Malody 皮肤（带缓存，失败时抛出） */
async function loadMalodySkin(dir = SKIN_DEFAULT_DIR) {
    if (_skinLoading) return _skinLoading;
    _skinLoading = (async () => {
        const skin = await MalodySkin.load(dir);
        // 皮肤脚本里以独立文件引用的贴图（长条体 / 尾巴）
        const externals = new Set();
        for (const el of skin.elements.values()) {
            for (const key of ['tex', 'tex2', 'tex3']) {
                const spec = el[key];
                if (spec && /\.(png|jpg|jpeg)$/i.test(spec)) externals.add(spec);
            }
        }
        await skin.preloadExternal(Array.from(externals));
        return skin;
    })();
    try {
        return await _skinLoading;
    } catch (err) {
        _skinLoading = null;
        throw err;
    }
}

/**
 * 启动时按存档设置初始化皮肤
 * @returns {Promise<MalodySkin|null>}
 */
async function initSkinFromSettings() {
    let mode = 'builtin';
    try {
        if (typeof settingsStore !== 'undefined') {
            const s = settingsStore.load();
            mode = s.skin === 'malody' ? 'malody' : 'builtin';
        }
    } catch { /* ignore */ }

    if (mode !== 'malody') {
        skinMode = 'builtin';
        activeSkin = null;
        return null;
    }

    try {
        activeSkin = await loadMalodySkin();
        skinMode = 'malody';
        console.log('[skin] Malody 皮肤已载入：', activeSkin.layout);
        return activeSkin;
    } catch (err) {
        console.warn('[skin] Malody 皮肤载入失败，回退内置扁平皮肤：', err);
        skinMode = 'builtin';
        activeSkin = null;
        return null;
    }
}

/**
 * 运行期切换皮肤
 * @param {'builtin'|'malody'} mode
 * @returns {Promise<MalodySkin|null>} 成功时返回皮肤实例；失败时回退并返回 null
 */
async function switchSkin(mode) {
    if (mode === 'malody') {
        try {
            activeSkin = await loadMalodySkin();
            skinMode = 'malody';
            return activeSkin;
        } catch (err) {
            console.warn('[skin] Malody 皮肤载入失败，保持内置扁平皮肤：', err);
            skinMode = 'builtin';
            activeSkin = null;
            return null;
        }
    }
    skinMode = 'builtin';
    activeSkin = null;
    return null;
}