# iOS 后台保活

## 问题

手机页面靠 `setInterval` 每秒拉一次命令。一旦浏览器切到后台或者锁屏，iOS 会限流甚至冻结定时器，轮询停掉，指令就送不到设备。

## 三层做法

### 1. 一路正在播放的媒体

有音频在播的页面会被 iOS 当成"正在被使用"，进程不会立刻挂起。页面里挂了一个静音音频和一个黑屏视频，开保活时同时 play。

生成媒体（体积极小，直接 base64 内联进 Worker）：

```bash
# 30 秒静音 m4a
python3 - <<'PY'
import wave
sr=44100; dur=30
w=wave.open('silent.wav','w'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
w.writeframes(b'\x00\x00'*(sr*dur)); w.close()
PY
ffmpeg -i silent.wav -ac 1 -ar 44100 -c:a aac -b:a 8k silent.m4a -y

# 10 秒黑屏视频，带一路静音音轨（PiP 需要有音轨才好触发）
python3 -c "
w,h,frames=480,270,150
y=b'\x10'*(w*h); u=b'\x80'*(w*h//4)
open('raw.yuv','wb').write((y+u+u)*frames)"
ffmpeg -f rawvideo -pix_fmt yuv420p -s 480x270 -r 15 -i raw.yuv -i silent.wav \
  -c:v libx264 -profile:v baseline -pix_fmt yuv420p -crf 38 -g 30 \
  -c:a aac -b:a 8k -shortest -movflags +faststart blank.mp4 -y

# 转 base64，填进 worker.js 的 SILENT_M4A_B64 / BLANK_MP4_B64
base64 -w0 silent.m4a > silent.b64
base64 -w0 blank.mp4  > blank.b64
```

视频别做太小。64×64 那种可能被 Safari 判定不适合画中画而拒绝，480×270 实测能进。

媒体端点必须支持 HTTP Range（返回 206），Safari 的媒体加载器强依赖这个，否则 `readyState` 一直是 0，看着像在播其实没加载。`worker.js` 里的 `mediaResponse` 已经处理了。

### 2. 画中画（PiP）

比静音音频可靠得多。视频进了 PiP，画面必须持续渲染，页面的 JS 也就跟着继续跑。

```js
if (v.webkitSetPresentationMode) {          // iOS Safari
  v.webkitSetPresentationMode('picture-in-picture');
} else if (v.requestPictureInPicture) {     // 标准 API
  v.requestPictureInPicture();
}
```

必须由用户手势触发（点按钮那一下的调用栈里），不能页面一加载就调。页面的做法是：点「开保活」按钮时同时 play 媒体并尝试进 PiP。

### 3. 用视频帧驱动轮询，而不是 setInterval

这是关键一层。`requestVideoFrameCallback` 跟着视频解码走，视频在放它就在回调，不受定时器限流影响：

```js
function pump(){
  var now = Date.now();
  if (now - lastPollAt >= 1000) { lastPollAt = now; poll(); }
  v.requestVideoFrameCallback(pump);
}
v.requestVideoFrameCallback(pump);
```

`setInterval` 那条留着当兜底，两条并行，谁活着算谁的。

## 怎么验证

页面上会显示三个数：心跳次数、最长空档、后台空档。

切到后台待几分钟再回来，看「后台空档」：

- 1-2 秒 → 后台没被冻，保活生效
- 十几秒到几十秒 → 被限流了，但没完全死
- 等于你离开的总时长 → 完全冻结，保活没起作用

## 实测边界

我这边只测到前台连续 15 分钟稳定（心跳 2285 次、最长空档 1.0 秒）。后台能撑多久没有实测数据，因为测的时候页面一直在前台。

已知的天花板：iOS 对后台页面的宽容度跟系统版本、电量、低电量模式、是否锁屏都有关，没有保证时长。锁屏比切后台更容易被杀。要长时间稳定，把手机屏幕保持点亮、页面留在前台最靠谱。
