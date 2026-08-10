# CyberBeat Pixel 🎵

一款纯前端、零依赖的 4K 网页节奏游戏

赛博像素风格 · Canvas 2D 渲染 · Web Audio 音频合成

---

## ✨ 功能特性

- **4K 下落式音符**：类 osu!mania / Malody 玩法，4 条轨道，支持 Tap 点按和 Hold 长条两种音符
- **双重谱面支持**：原生支持 **Malody .mc 谱面**（精确 BPM 变化）和 **标准 MIDI 文件**（自动生成 4K 谱面）
- **三种音频模式**：Ogg 伴奏音频播放、MIDI 实时合成、内置预设节拍音序器
- **多难度系统**：EASY / EASY+ / NORMAL / NORMAL+ 四档难度
- **视觉特效**：粒子爆炸、激光光束、判定文字动画、倒计时动画
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
| 屏幕 | 建议 1280×720 以上 |

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
4. **结算**：游戏结束后显示成绩（分数、准确率、连击、判定统计）

### 快捷键

| 按键 | 功能 |
| :----: | :----: |
| `` ` `` / `~` | 切换性能监控面板 |
| `D` `F` `J` `K` | 游戏轨道按键 |
| `ESC` / `P` | 游戏内暂停 / 继续（暂停中 `R` 重试、`H` 回主菜单） |
| `←` `→` | 选曲界面左右切换 |
| `↑` `↓` | 调整下落速度 |

### 移动端

触屏设备上，屏幕底部左右两侧各有两个触控区域，对应 4 条轨道。

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
│   └── style.css             # 完整设计系统（赛博暗色主题）
│
├── js/
│   ├── main.js               # 主入口：初始化、渲染循环、游戏主循环
│   ├── config.js             # 游戏常量 + JSON 配置加载器
│   ├── audio-engine.js       # Web Audio API 音频引擎
│   ├── game-state.js         # 游戏状态管理
│   ├── renderer.js           # Canvas 渲染器（轨道/音符/粒子/特效）
│   ├── ui.js                 # UI 管理器（选曲/设置/结算）
│   ├── mc-parser.js          # Malody .mc 谱面解析器
│   ├── midi-parser.js        # 标准 MIDI 文件解析器
│   ├── note-generator.js     # 音符生成器（预设谱面 + MIDI 自动谱面）
│   └── perf-monitor.js       # 实时性能监控
│
├── data/
│   ├── audio.json            # 音频引擎参数
│   └── judge.json            # 判定参数
│
└── assets/
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
| HTML5 + CSS3 | UI 布局和样式（毛玻璃、霓虹光晕效果） |
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
