# 结算音乐 (Result Audio)

结算界面播放的背景音乐文件存储在此目录。

## 文件说明

### completed.mp3
- **用途**: 游戏成功完成时播放
- **来源**: 原始文件为 `untitled.mp3`
- **命名建议**: 根据内容修改（如 `victory.mp3`、`success.mp3`、`celebration.mp3`）

### failed.mp3
- **用途**: 游戏失败时播放
- **来源**: 原始文件为 `Testify Story.mp3`
- **命名建议**: 根据内容修改（如 `defeat.mp3`、`failure.mp3`、`retry.mp3`）

## 音量控制

结算音乐的音量与**游玩前设置中的音量大小**相同（0-10 等级），音频播放时会自动读取用户在设置界面设定的音量值。

## 技术细节

- 音乐文件路径: `assets/result-audio/[filename].mp3`
- 支持格式: MP3（推荐）、WAV、OGG、AAC 等浏览器支持的音频格式
- 音量范围: 0-1（脚本自动从 0-10 转换）
- 播放触发: 结算界面显示时自动播放
- 音量控制变量: `currentVolume` (全局变量)

## 设置流程

1. 将音乐文件放入此目录，并命名为 `completed.mp3` 和 `failed.mp3`
2. 程序自动调用这两个文件进行播放
3. 游玩者可在设置界面（Setting）调整音量，结算音乐将使用该音量值播放
