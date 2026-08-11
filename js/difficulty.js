// ==================== 谱面难度计算器 ====================
// 移植自 osumania_map_analyser (https://github.com/LeoBlackMT/osumania_map_analyser)
// 中的 Interlude Star Rating 算法（YAVSRG/Interlude，MIT 协议）。
//
// 算法流程（与上游一致）：
//   1. noteDifficulty：逐列计算每个音符的
//      - J  ：同列叠键评级 = min(15000 / 同列间隔ms, 230)（即叠键 BPM，封顶 230）
//      - SL/SR：同手其他列的"滚奏/三连"评级 = StreamBPM(间隔) × Jack补偿
//        StreamBPM(δ) = 300/(0.02δ) - 300/(0.02δ)^10 / 10
//        Jack补偿     = min(1, sqrt(log2(同列间隔 / 他列间隔)))
//      - Total：SL、SR、J 的 L3 范数 (6√SL, 6√SR, J)
//   2. strain：单列手指应变（半衰期 1575ms 的指数衰减平滑，输入取 Total²×0.01626）
//   3. overall：取全部正应变值，按升序加权平均（最后 2500 个音符按 x⁴ 加权），
//      再 ^0.6 × 0.4056 压缩为星数（Interlude SR）。
// 输入谱面格式与 McParser / OsuParser 产出的 notes 完全一致，
// 因此同时适用于 .mc / .osu / .osz 中的谱面（hold 音符按长条头 HOLDHEAD 计）。

class DifficultyCalculator {
    /**
     * @param {Array} notes - 谱面音符 [{ track, time, type: 'tap'|'hold', endTime }]
     * @param {Object} [options] - 覆盖默认参数（一般无需传入）
     */
    constructor(notes, options = {}) {
        this.notes = notes || [];
        this.rate = options.rate ?? 1.0;   // 谱面倍速（无 mod 时为 1）
    }

    /**
     * 计算谱面难度
     * @returns {{ star:number, level:number, difficultyValue:number,
     *             noteCount:number, noteRows:number }}
     */
    calculate() {
        if (!Array.isArray(this.notes) || this.notes.length === 0) {
            return { star: 0, level: 0, difficultyValue: 0, noteCount: 0, noteRows: 0 };
        }

        const rate = Number.isFinite(this.rate) && this.rate > 0 ? this.rate : 1.0;
        const keys = 4;
        const handSplit = 2;   // keysOnLeftHand(4) = 2

        // ---- 构建音符行 { time, data[4] }：data ∈ {0 空, 1 tap, 2 hold 头} ----
        const rowsMap = new Map();
        for (const n of this.notes) {
            const t = Math.floor(Number(n.time) || 0);
            const col = n.track | 0;
            if (col < 0 || col >= keys) continue;
            let row = rowsMap.get(t);
            if (!row) {
                row = { time: t, data: [0, 0, 0, 0] };
                rowsMap.set(t, row);
            }
            row.data[col] = (n.type === 'hold') ? 2 : 1;   // HOLDHEAD / NORMAL
        }
        const rows = [...rowsMap.values()].sort((a, b) => a.time - b.time);
        const rowCount = rows.length;

        // ---- 1. 逐列音符评级（noteDifficulty）----
        const JACK_CURVE_CUTOFF = 230.0;
        const STREAM_CURVE_CUTOFF = 10.0;
        const STREAM_CURVE_CUTOFF_2 = 10.0;
        const OHTNERF = 3.0;
        const STREAM_SCALE = 6.0;
        const STREAM_POW = 0.5;

        const msToJackBpm = (delta) => {
            const value = delta <= 0 ? 230 : Math.min(15000 / delta, 230);
            return value < JACK_CURVE_CUTOFF ? value : JACK_CURVE_CUTOFF;
        };

        const msToStreamBpm = (delta) => {
            const x = 0.02 * delta;
            if (!Number.isFinite(x) || x <= 0) return 0.0;
            const value = (300.0 / x) - (300.0 / Math.pow(x, STREAM_CURVE_CUTOFF)) / STREAM_CURVE_CUTOFF_2;
            return value > 0 ? value : 0.0;
        };

        const jackCompensation = (jackDelta, streamDelta) => {
            const ratio = jackDelta / streamDelta;
            if (!Number.isFinite(ratio) || ratio <= 0) return 0.0;
            return Math.min(1.0, Math.sqrt(Math.max(0.0, Math.log2(ratio))));
        };

        const noteDifficultyTotal = (sl, sr, j) => Math.pow(
            Math.pow(STREAM_SCALE * Math.pow(sl, STREAM_POW), OHTNERF) +
            Math.pow(STREAM_SCALE * Math.pow(sr, STREAM_POW), OHTNERF) +
            Math.pow(j, OHTNERF),
            1.0 / OHTNERF
        );

        const lastNoteInColumn = new Array(keys).fill(rows[0].time - 1000000.0);
        const noteDiff = new Array(rowCount);
        for (let i = 0; i < rowCount; i++) {
            const row = rows[i];
            const time = row.time;
            const per = new Array(keys);

            for (let k = 0; k < keys; k++) {
                const nt = row.data[k];
                if (nt === 0) { per[k] = null; continue; }

                const jackDelta = (time - lastNoteInColumn[k]) / rate;
                const j = msToJackBpm(jackDelta);

                const handLo = k < handSplit ? 0 : handSplit;
                const handHi = k < handSplit ? handSplit - 1 : keys - 1;
                let sl = 0.0, sr = 0.0;

                for (let handK = handLo; handK <= handHi; handK++) {
                    if (handK === k) continue;
                    const trillDelta = (time - lastNoteInColumn[handK]) / rate;
                    const trillValue = msToStreamBpm(trillDelta) * jackCompensation(jackDelta, trillDelta);
                    if (handK < k) sl = Math.max(sl, trillValue);
                    else sr = Math.max(sr, trillValue);
                }

                per[k] = { J: j, SL: sl, SR: sr, Total: Math.fround(noteDifficultyTotal(sl, sr, j)) };
            }

            noteDiff[i] = per;
            for (let k = 0; k < keys; k++) {
                if (row.data[k] !== 0) lastNoteInColumn[k] = time;
            }
        }

        // ---- 2. 手指应变（burst 半衰期 1575ms）+ 手部应变（0.875 burst + 0.125 stamina）----
        const STRAIN_SCALE = 0.01626;
        const STRAIN_TIME_CAP = 200.0;

        const createStrainFunction = (halfLife) => {
            const decayRate = Math.log(0.5) / halfLife;
            return (value, input, delta) => {
                const clampedDelta = Math.min(STRAIN_TIME_CAP, delta);
                const decay = Math.exp(decayRate * clampedDelta);
                const timeCapDecay = delta > STRAIN_TIME_CAP
                    ? Math.exp(decayRate * (delta - STRAIN_TIME_CAP))
                    : 1.0;
                const a = value * timeCapDecay;
                const b = input * input * STRAIN_SCALE;
                return b - (b - a) * decay;
            };
        };

        const strainBurst = createStrainFunction(1575.0);
        const strainStamina = createStrainFunction(60000.0);

        const strainValues = [];
        const lastCol = new Array(keys).fill(0.0);
        const strainV1 = new Array(keys).fill(0.0);
        const lastColHand = Array.from({ length: keys }, () => [0.0, 0.0, 0.0]);

        for (let i = 0; i < rowCount; i++) {
            const row = rows[i];
            const offset = row.time;

            for (let k = 0; k < keys; k++) {
                if (row.data[k] === 0) continue;
                const d = noteDiff[i][k].Total;
                strainV1[k] = strainBurst(strainV1[k], d, (offset - lastCol[k]) / rate);
                lastCol[k] = offset;
            }

            // 手部应变（仅用于辅助诊断，不进入 overall）
            let lBurst = 0.0, lStamina = 0.0, rBurst = 0.0, rStamina = 0.0;
            for (let k = 0; k < keys; k++) {
                if (row.data[k] === 0) continue;
                const d = noteDiff[i][k].Total;
                if (k < handSplit) {
                    for (let hk = 0; hk < handSplit; hk++) {
                        const [pb, ps, pt] = lastColHand[hk];
                        lBurst = Math.max(lBurst, strainBurst(pb, d, (offset - pt) / rate));
                        lStamina = Math.max(lStamina, strainStamina(ps, d, (offset - pt) / rate));
                    }
                } else {
                    for (let hk = handSplit; hk < keys; hk++) {
                        const [pb, ps, pt] = lastColHand[hk];
                        rBurst = Math.max(rBurst, strainBurst(pb, d, (offset - pt) / rate));
                        rStamina = Math.max(rStamina, strainStamina(ps, d, (offset - pt) / rate));
                    }
                }
            }
            for (let k = 0; k < keys; k++) {
                if (row.data[k] === 0) continue;
                if (k < handSplit) lastColHand[k] = [lBurst, lStamina, offset];
                else lastColHand[k] = [rBurst, rStamina, offset];
            }

            for (let k = 0; k < keys; k++) {
                const v = strainV1[k];
                if (v > 0) strainValues.push(v);
            }
        }

        // ---- 3. 总体难度：升序加权平均 → ^0.6 × 0.4056 ----
        const CURVE_POWER = 0.6;
        const CURVE_SCALE = 0.4056;
        const MOST_IMPORTANT_NOTES = 2500.0;

        const values = strainValues.slice().sort((a, b) => a - b);
        const length = values.length;
        let weight = 0.0, total = 0.0;
        for (let i = 0; i < length; i++) {
            const x = Math.max(0.0, (i + MOST_IMPORTANT_NOTES - length) / MOST_IMPORTANT_NOTES);
            const w = 0.002 + Math.pow(x, 4.0);
            weight += w;
            total += (Number(values[i]) || 0.0) * w;
        }

        let star = 0;
        if (Number.isFinite(weight) && weight > 0) {
            star = Math.pow(total / weight, CURVE_POWER) * CURVE_SCALE;
        }

        // ---- LEVEL 换算（level ≈ star × 4，0~40 刻度）----
        const level = Math.round(star * 4);

        return {
            star: Math.round(star * 100) / 100,
            level: Math.max(0, Math.min(level, 40)),
            difficultyValue: Math.round(star * 100) / 100,
            noteCount: this.notes.length,
            noteRows: rowCount
        };
    }
}