# CyberBeat Pixel 曲库

此目录存放游戏曲库中的 MIDI 文件与 MC 谱面。

## 目录结构

```text
assets/
├── songs/          ← MIDI 文件、MC 谱面、menu.json
│   ├── menu.json
│   ├── *.mid
│   └── *.mc
└── mc_audio/       ← MC 歌曲对应的音频文件
    └── *.ogg / *.mp3 / *.wav
```

## menu.json 歌曲条目格式

### MIDI 歌曲（原有格式）

```json
{
  "id": "1",
  "file": "song.mid",
  "title": "Song Title",
  "artist": "Artist Name",
  "preview": null,
  "difficulties": ["normal", "normal+"]
}
```

### MC 谱面歌曲

```json
{
  "id": "2",
  "audio": "song.ogg",
  "beatmap": "chart.mc",
  "beatmapType": "mc",
  "title": "Song Title",
  "artist": "Artist Name",
  "preview": null
}
```

- `file`（MIDI 歌曲）：MIDI 文件路径，相对于 `assets/songs/`
- `audio`（MC 歌曲）：音频文件路径，相对于 `assets/mc_audio/`。支持 .ogg / .mp3 / .wav
  - 若为 MIDI 文件则走合成器播放
  - 若为音频则直接解码播放（受音量滑块控制）
  - 若为 `null` 则回退到预设音乐
- `beatmap`：MC 谱面文件路径，相对于 `assets/songs/`
- `beatmapType`：`"mc"` 表示 Malody 谱面格式
- MC 谱面无需 `difficulties` 字段（谱面难度已固定）
