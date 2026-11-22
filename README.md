# CyberBeat Pixel 🎵

一款纯前端、零依赖的 4K 网页节奏游戏

赛博像素风格 · Canvas 2D 渲染 · Web Audio 音频合成

---

## ✨ 功能特性

- **4K 下落式音符**：类 osu!mania / Malody 玩法，4 条轨道，支持 Tap 点按和 Hold 长条两种音符
- **双重谱面支持**：原生支持 **Malody .mc 谱面**（精确 BPM 变化）和 **标准 MIDI 文件**（自动生成 4K 谱面）
- **三种音频模式**：Ogg 伴奏音频播放、MIDI 实时合成、内置预设节拍音序器
- **多难度系统**：EASY / EASY+ / NORMAL / NORMAL+ 四档难度
- **扁平游玩 HUD**：曲名 / 艺术家 / 谱面难度、顶部播放进度条、实时分数与准确率、判定统计、生命值、连击放大、近期打击偏移条（EARLY / LATE）、低血量闪红边框
- **音符样式**：FLAT（扁平块，默认）/ PIXEL（像素块），均为纯色块 + 1px 描边，可随时切换
- **皮肤系统**：内置扁平皮肤 / **Malody V .mui 皮肤**（已接入 Yuxen 4K：轨道、音符、长条、按键；判定文字与判定线沿用本项目处理），设置页一键切换
- **视觉特效**：方块粒子、命中判定线加粗、判定文字动画、倒计时卡片
- **实时性能监控**：按下 `` ` `` 键即可查看 FPS、帧时间、音频延迟
- **数据驱动配置**：判定窗口、血量、音效参数均通过外部 JSON 配置，无需改代码
- **纯前端运行**：无需服务器、无需数据库、零依赖，打开即玩

## 🚀 快速开始

### 在线游玩

直接使用浏览器打开 `index.html` 即可。

### 本地运行

```bash
# 克隆仓库
git clone <repo-url>
cd cyberbeat

# 直接用浏览器打开 index.html
# 或者用任意静态服务器
npx serve .
```

### 系统要求

| 项目 | 要求 |
| :--- | :--- |
| 浏览器 | Chrome 80+ / Firefox 80+ / Edge 80+ / Safari 14+ |
| 音频 | 需支持 Web Audio API |
| 屏幕 | 桌面建议 1280×720 以上；移动端竖屏 320×568 起即畅玩（横屏也完整支持） |

## 🎮 操作说明

### 键位

| 轨道 | 键盘 |
| :----: | :----: |
| 1 | `D` |
| 2 | `F` |
| 3 | `J` |
| 4 | `K` |

### 游戏流程

1. **选曲**：从曲库列表选择歌曲，或点击「IMPORT MIDI」导入本地 `.mid` 文件
2. **设置**：点击 `SETTING` 调整难度、速度（6.0~21.0）、音符样式、音量和全局判定偏移（GLOBAL OFFSET，用于校准音频延迟）
3. **开始**：点击 `START`，3 秒倒计时后开始游玩
4. **暂停**：`ESC` / `P` 或右上角按钮，面板会显示当前曲目、分数、准确率与连击，继续后走 3 秒缓冲倒计时
5. **结算**：游戏结束后显示成绩（分数、准确率、连击、判定统计）

### 游玩界面 HUD

界面采用扁平设计：纯色块、1px 描边、无渐变 / 无发光 / 无投影，信息层级靠色阶与字号区分。

| 位置 | 内容 |
| :---- | :---- |
| 顶部 | 全宽播放进度条（单色填充 + 方形播放头） |
| 左上 | `SCORE` 实时总分、`ACCURACY` 实时准确率、`P / G / M` 判定统计 |
| 右上 | `LIFE` 生命值条（纯色填充、30% 危险刻度，血量低于 30% 时画面边框闪红） |
| 顶部中央 | 曲名 / 艺术家 / 谱面难度，以及最近一次打击的偏差条（黄色块为 PERFECT 窗口） |
| 画面中央 | 连击数与 `COMBO` 标签，命中时放大，50 连以上转为金色 |
| 判定线上 | 2px 白色判定线 + 4 个扁平键位接收器；按下时整轨淡色底、接收器填满轨道色，漏击时判定线上方闪红条 |
| 底部 | 移动端 4 个触控键（深色底 + 轨道色描边，按下整块填充轨道色），宽度与轨道区一致 |

### 快捷键

| 按键 | 功能 |
| :----: | :----: |
| `` ` `` / `~` | 切换性能监控面板 |
| `D` `F` `J` `K` | 游戏轨道按键 |
| `ESC` / `P` | 游戏内暂停 / 继续（暂停中 `R` 重试、`H` 回主菜单） |
| `←` `→` | 选曲界面左右切换 |
| `↑` `↓` | 调整下落速度 |

### 移动端

全面支持手机竖屏 / 横屏游玩：

- **触控轨道按键**：游戏进行中屏幕底部显示 4 个全宽触控键（多点触控，双拇指可同时按压不同轨道）；非游戏界面自动隐藏
- **全屏轨道映射 + 滑动换轨**：直接点按游戏画面任意位置即可触发对应轨道（屏幕横向均分为 4 轨，无需精确瞄准）；按住后左右滑动可实时切换轨道，多指同轨互不干扰，Hold 手指滑出旧轨自动提前释放
- **触控点显示**：按住时显示对应轨道颜色的呼吸圆环，松开时留下扩散涟漪，滑动换轨时圆环颜色实时切换；设置页 TOUCH FEEDBACK 可开关（仅触屏设备显示该项）
- **游戏内按钮**：右上角暂停按钮（连点 5 次可切换性能监控面板）、长前奏曲目自动出现 SKIP INTRO 按钮、暂停面板显示曲目与实时成绩并支持 继续 / 重试 / 回主页
- **横屏优化**：矮窗口下触控键收窄至右下角，性能面板移至左上，HUD 自动避让
- **安全区适配**：刘海屏 / 手势条（`env(safe-area-inset-*)`）全布局避让，音符判定线上移不被手指遮挡
- **性能优化**：触屏设备自动降低渲染分辨率（DPR 上限 1.5~1.75）、减少打击粒子数、开始画面限帧 ~30fps 省电
- **后台保护**：切到后台自动暂停游戏；Web Audio 在部分浏览器不可用时给出提示
- **防误触**：游戏内禁用双击缩放、长按菜单、双指捏合；设置页 / 排行榜内部列表保留正常滚动

## 🎨 皮肤（Skin）

游玩界面支持两套皮肤，在 `SETTING → SKIN` 切换，选择会写入本地存档：

| 皮肤 | 说明 |
| :---- | :---- |
| `BUILT-IN` | 内置扁平皮肤：纯色块音符 + 1px 描边（默认） |
| `MALODY V` | Malody V 4.3.x 的 `.mui` 脚本皮肤：Yuxen 4K（作者 Lowwy），接管轨道底板、键位列、按下列、音符与长条；**判定文字用本项目样式（PERFECT / GREAT / MISS）**，**判定线隐藏**（只保留判定线处的接收器） |

启用 Malody 皮肤后 `NOTE STYLE` 会置灰——音符形状由皮肤脚本决定，不再使用内置 FLAT/PIXEL 样式。

### 已接入的皮肤包

```text
assets/skins/yuxen/
├── base.mui                    # 公共图元（判定字、分数、血条、进度条）
├── script-key-4K.mui           # 4K 轨道 / 音符 / 按键脚本（本作使用这份）
├── script-key-{5,6,7}K.mui     # 5K/6K/7K 脚本（保留备用）
├── Yassets.plist               # TexturePacker 图集描述（帧矩形 + 旋转标记）
├── Yassets.png                 # 图集（2041×2045）
├── YnoteL.png / YnoteT.png     # 长条体 / 尾端独立贴图（不在图集里）
├── preview.json                # Malody 皮肤封面信息
└── _How_to_Edit_HitPosition.txt# 原作者关于 HITPOSITION 的说明
```

### 支持能力（`.mui` 子集）

- `@include` 合并、`@define` 变量、`{HITPOSITION}` 占位符
- 元素选择器 `name-[1-4]` / `name-[1,3,5,7]` / `name-[4]`，同名元素后者覆盖前者
- `pos` 中的 `$步进`（如 `50%-157.5$105`）换算轨道间距；`size` / `pos` 里的 `50%`、`100%-25`、`420+40` 表达式
- 图元来源：`tex` / `tex2` / `tex3` / `frame`（`frame=Yjud/0-3` 取首帧），图集里没有的贴图按文件名从皮肤目录加载
- `color`（白底贴图着色）与 `opacity`（百分比）
- TexturePacker 图集的 `rotated` 旋转图元会自动还原；若某图元取反，可用 `js/skin.js` 顶部的 `SKIN_ATLAS_ROTATE_DIR` 调整还原方向

### 判定线高度（HITPOSITION）

`script-key-4K.mui` 顶部的 `@define HITPOSITION 72.5` 决定判定线位置：数值越大判定线越靠上（作者建议 37~150，可用小数）。

本作的换算方式是 `判定线距顶部比例 = 1 − (HITPOSITION + 25) / 900`，再被底部触控键 + 安全区夹住——所以手机上判定线永远不会落进按键区。

判定位置仍按这套数值排布音符、接收器与判定文字，只是**不绘制皮肤里的判定线贴图**（`Ybar4k`），画面更干净。

### 皮肤取舍开关

`js/renderer.js` 顶部的 `SKIN_DRAW` 控制两个可选项：

```js
const SKIN_DRAW = {
    useSkinJudgments: false,   // true = 用皮肤 Yjud 的 COOL/GOOD/MISS 贴图；false = 用本项目判定文字
    showBar: false             // true = 绘制皮肤 Ybar4k 判定线；false = 隐藏判定线
};
```

默认两项都关闭：判定文字统一用本项目的扁平文字，判定线隐藏，避免与内置 HUD 风格混搭。

### 限制

- 目前只接 4K：加载 `script-key-4K.mui`，5K/6K/7K 脚本随包保留但未启用
- 皮肤接管的是赛道与判定表现；顶部进度条、分数、准确率、血条、连击仍用内置扁平 HUD（皮肤里的 `Yscore-*` 数字贴图 / `Ylife` 血条暂未使用）
- 皮肤贴图需要静态服务器（`fetch` 加载 `.mui` 与 `.plist`），直接双击打开 `index.html` 会回退到内置皮肤

> ⚠️ 该皮肤包自带声明：`do not use the scripts without permission`（作者 Lowwy / lowwy02）。本仓库接入仅供本地自用与研究；对外分发或二次发布前请先取得原作者授权。

## 📚 曲库

### 内置歌曲

| 曲名 | 作者 | 谱面格式 | 难度 |
| :---- | :---- | :--------: | :----: |
| Last | onoken | MIDI | Lv.7 / Lv.28 |
| Adjudicatorz-断罪- | JurokuNeta. | MC | Lv.23 |
| Haikyo, Kikai and Shizen | Arkplot | MC | Lv.31 |
| the_world_of_scarlet | OfficialAz3 | MC | Lv.26 |
| Regular-5 | Various Artists | MC | Lv.27 |

### 添加曲目

#### 添加 MIDI 歌曲

1. 将 `.mid` 文件放入 `assets/songs/`
2. 在 `assets/songs/menu.json` 中添加条目：

```json
{
  "id": "6",
  "file": "your-song.mid",
  "title": "Your Song",
  "artist": "Artist Name",
  "preview": null,
  "difficulties": [
    { "key": "normal",  "name": "NORMAL",  "level": 7 },
    { "key": "normal+", "name": "NORMAL+", "level": 20 }
  ]
}
```

#### 添加 MC 谱面歌曲

1. 将 `.mc` 谱面放入 `assets/songs/`
2. 将 `.ogg` / `.mp3` 伴奏音频放入 `assets/mc_audio/`
3. 在 `menu.json` 中添加条目：

```json
{
  "id": "6",
  "audio": "your-song.ogg",
  "beatmap": "your-song.mc",
  "beatmapType": "mc",
  "title": "Your Song",
  "artist": "Artist Name",
  "preview": null,
  "level": 25,
  "difficultyName": "NORMAL"
}
```

> **注意**：MC 谱面要求 `column=4`（4K 布局），不支持的谱面会报错提示。

## ⚙️ 配置

游戏参数通过外部 JSON 文件配置，修改后刷新页面即可生效：

| 配置文件 | 用途 |
| :--------- | :----- |
| `data/judge.json` | 判定窗口（Perfect/Great）、血量、特效参数 |
| `data/audio.json` | 限幅器、MIDI 合成器、预设音乐、音效、混响参数 |
| `js/config.js` | 游戏核心常量（轨道数、宽度、默认 BPM 等） |

## 🧱 项目结构

```text
cyberbeat/
├── index.html                # 主入口（开始/设置/结算画面）
│
├── pages/
│   ├── faq.html              # 判定与记分说明页面
│   └── result-preview.html   # 结算界面视觉预览（开发用）
│
├── css/
│   └── style.css             # 完整设计系统（赛博暗色主题 + 移动端响应式）
│
├── js/
│   ├── main.js               # 主入口：初始化、渲染循环、游戏主循环
│   ├── config.js             # 游戏常量 + JSON 配置加载器 + 设备/触控检测
│   ├── audio-engine.js       # Web Audio API 音频引擎
│   ├── game-state.js         # 游戏状态管理
│   ├── renderer.js           # Canvas 渲染器（轨道/音符/粒子/特效/HUD/皮肤绘制）
│   ├── skin.js               # Malody V 皮肤加载器（.mui 解析 + plist 图集 + 着色缓存）
│   ├── ui.js                 # UI 管理器（选曲/设置/结算/触控输入/暂停）
│   ├── mc-parser.js          # Malody .mc 谱面解析器
│   ├── midi-parser.js        # 标准 MIDI 文件解析器
│   ├── note-generator.js     # 音符生成器（预设谱面 + MIDI 自动谱面）
│   └── perf-monitor.js       # 实时性能监控
│
├── data/
│   ├── audio.json            # 音频引擎参数
│   └── judge.json            # 判定参数
│
├── docs/                     # 界面截图（扁平皮肤 / Malody 皮肤 / 移动端适配）
│
└── assets/
    ├── skins/yuxen/          # Malody V 皮肤包（.mui 脚本 + plist 图集）
    ├── songs/                # MIDI / MC 谱面
    │   ├── menu.json         # 曲库清单
    │   ├── *.mid
    │   └── *.mc
    ├── mc_audio/             # MC 歌曲伴奏音频
    ├── result-audio/         # 结算音乐（可选）
    └── osz/                  # osu! 谱面包（*.osz 导入文件）
```

## 🛠️ 技术栈

| 技术 | 用途 |
| :----- | :----- |
| HTML5 + CSS3 | UI 布局和样式（菜单毛玻璃、扁平游玩界面） |
| Canvas 2D | 游戏画面实时渲染 |
| Web Audio API | 音频合成、播放、限幅和混响 |
| Fetch API | 加载 JSON 配置和曲库数据 |
| FileReader | 导入本地 MIDI 文件 |
| 对象池 + 滑动窗口 | 性能优化（减少 GC 压力） |

## ⚡ 性能优化

- **VSync 帧时序平滑**：限制最大帧间隔，防止卡顿感
- **帧跳过保护**：累积异常时直接跳帧，防止螺旋式掉帧
- **二分查找**：快速定位可视范围内的音符，避免全量遍历
- **可见性裁剪**：仅渲染屏幕内的音符、粒子等对象
- **对象池**：Gain 节点、粒子、激光、判定文字均使用对象池
- **安全退出阈值**：音符全部在屏幕上方时提前终止渲染循环

## 📄 许可证

本项目仅供学习和个人使用。

---

> Made with ❤️
