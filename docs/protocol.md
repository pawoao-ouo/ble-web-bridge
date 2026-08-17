# 接你自己的设备

页面里只有两处跟具体设备有关，其余都是通用的。

## 1. UUID

`page/index.html` 顶部：

```js
var BLE_SERVICE='0000ff10-0000-1000-8000-00805f9b34fb';  // 示例值
var BLE_TX     ='0000ff12-0000-1000-8000-00805f9b34fb';  // 示例值
```

`BLE_SERVICE` 是设备的 GATT service UUID，`BLE_TX` 是可写的 characteristic。

怎么找：

- 桌面 Chrome 开 `chrome://bluetooth-internals` → Devices → 连上你的设备 → 看 Services / Characteristics 列表，找带 WRITE 属性的那个
- 手机上用 nRF Connect（iOS/Android 都有），连上后同样能看到完整 GATT 树
- 16 位短 UUID（如 `FF10`）在 Web Bluetooth 里要写成完整形式：`0000ff10-0000-1000-8000-00805f9b34fb`

Web Bluetooth 有个坑：`requestDevice` 时如果不在 `optionalServices` 里声明，之后 `getPrimaryService` 会报 SecurityError。所以两个 UUID 都要提前填对。

## 2. 数据包

```js
function buildPacket(level){
  var b=new Uint8Array(1);
  b[0]=Math.max(0,Math.min(100,Math.round(level)));
  return b.buffer;
}

function buildStopPacket(){
  return buildPacket(0);
}
```

示例是最简单的情况：一个字节表示强度。真实设备通常更复杂——定长包、包头魔数、双通道重复、校验位、位移打包。

抓真机包的路子：

1. 装厂商官方 App，Android 打开开发者选项里的「蓝牙 HCI 信息收集日志」
2. 用官方 App 操作几档不同强度，各停几秒
3. 导出 `btsnoop_hci.log`，Wireshark 打开，过滤 `btatt.opcode == 0x52`（Write Command）或 `0x12`（Write Request）
4. 对比不同强度下的包，看哪几个字节在变

常见的编码套路（对着抓出来的字节猜）：

| 现象 | 可能是 |
|---|---|
| 只有一个字节随强度线性变 | 直接 0-100 或 0-255 映射 |
| 两个字节一起变，低位溢出后高位 +1 | 小端 16 位整数 |
| 变化的值不是整数倍，像是被乘过 | 有缩放系数，例如 `v*0.7+0.3` 再乘满量程 |
| 末尾几位固定不变 | 低位是模式标志，被位移打包进同一个整数 |
| 包里有两段一模一样的内容 | 双马达/双通道，各发一份 |

写出 `buildPacket` 之后，先用固定强度试一次，确认设备有反应再接页面。

## 3. 保持写入

很多设备收到一次指令后只维持很短时间，不持续喂就自己停。页面里的做法是 200ms 重发一次同一个包：

```js
resendHandle=setInterval(function(){sendBLE(buf)},200);
```

如果你的设备是状态式的（写一次就一直保持），把这行删掉即可。

## 4. 首次写入很慢

冷启动第一次 `writeValue` 可能要好几秒（建立连接 + 协商 MTU），之后每次 100-250ms。开玩前先手动写一次热身，不要在关键时刻等它。
