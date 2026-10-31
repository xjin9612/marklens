---
title: 安全性測試
---

# 安全性測試

每個攻擊成功時都會在 `<body>` 留下 `data-xss` 標記或跳出對話框；測試預期兩者都不會發生。
部分案例改寫自 local-markdown-viewer 的 security-tests.md（MIT, © 2025 mutsuya117）。

## 1. script 標籤

<script>document.body.dataset.xss='script-1'</script>
<script type="text/javascript">document.body.dataset.xss='script-2'</script>
<script src="https://example.invalid/evil.js"></script>
<SCRIPT>document.body.dataset.xss='script-upper'</SCRIPT>

## 2. 事件屬性

<img src="x" onerror="document.body.dataset.xss='onerror'">
<img src="x" ONERROR="document.body.dataset.xss='onerror-upper'">
<img src=x onerror=document.body.dataset.xss='onerror-unquoted'>
<div onclick="document.body.dataset.xss='onclick'" id="click-target">點我不應有反應</div>
<p onmouseover="document.body.dataset.xss='onmouseover'">滑過不應有反應</p>
<body onload="document.body.dataset.xss='body-onload'">
<input autofocus onfocus="document.body.dataset.xss='onfocus'">
<button onclick="document.body.dataset.xss='button'">按鈕</button>
<details open ontoggle="document.body.dataset.xss='ontoggle'"><summary>details</summary>內容</details>
<marquee onstart="document.body.dataset.xss='marquee'">marquee</marquee>
<video src="x" onerror="document.body.dataset.xss='video-onerror'"></video>
<audio src="x" onerror="document.body.dataset.xss='audio-onerror'"></audio>

## 3. javascript: 與其他危險 scheme

[markdown 連結](javascript:document.body.dataset.xss='md-link')

<a href="javascript:document.body.dataset.xss='a-href'" class="evil-link">HTML 連結</a>
<a href=" JaVaScRiPt:document.body.dataset.xss='a-mixed-case'" class="evil-link">大小寫混合</a>
<a href="&#106;avascript:document.body.dataset.xss='a-entity'" class="evil-link">實體編碼</a>
<a href="java&#x09;script:document.body.dataset.xss='a-tab'" class="evil-link">夾 Tab</a>
<a href="java&#x0A;script:document.body.dataset.xss='a-newline'" class="evil-link">夾換行</a>
<a href="vbscript:msgbox(1)" class="evil-link">vbscript</a>
<a href="javascript:void(0)" onclick="document.body.dataset.xss='a-onclick'" class="evil-link">void + onclick</a>

![markdown 圖片](javascript:document.body.dataset.xss='md-img')

## 4. data: scheme

<img src="data:text/html,<script>document.body.dataset.xss='data-img'</script>">
<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIG9ubG9hZD0iYWxlcnQoMSkiLz4=" alt="svg data">
<a href="data:text/html,<script>document.body.dataset.xss='data-a'</script>" class="evil-link">data 連結</a>
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" alt="safe-png" id="safe-png">

## 5. 內嵌框架與外掛

<iframe src="javascript:document.body.dataset.xss='iframe'"></iframe>
<iframe srcdoc="<script>parent.document.body.dataset.xss='srcdoc'</script>"></iframe>
<object data="javascript:document.body.dataset.xss='object'"></object>
<embed src="javascript:document.body.dataset.xss='embed'">
<frameset><frame src="javascript:alert(1)"></frameset>

## 6. style

<style>body { display: none !important; }</style>
<div style="position:fixed;inset:0;background:red;z-index:99999" id="style-overlay">不應覆蓋整頁</div>
<span style="background:url('javascript:alert(1)')">行內 style</span>

## 7. SVG 與 MathML

<svg onload="document.body.dataset.xss='svg-onload'"><circle r="10"/></svg>
<svg><script>document.body.dataset.xss='svg-script'</script></svg>
<svg><a href="javascript:alert(1)"><text y="20">svg link</text></a></svg>
<math><mtext><img src=x onerror="document.body.dataset.xss='mathml'"></mtext></math>

## 8. 編碼繞過

<img src="x" onerror="eval(atob('ZG9jdW1lbnQuYm9keS5kYXRhc2V0Lnhzcz0nYXRvYic='))">
<img src="x" onerror="&#100;&#111;&#99;&#117;&#109;&#101;&#110;&#116;.body.dataset.xss='entity-handler'">
<scr<script>ipt>document.body.dataset.xss='nested-script'</scr</script>ipt>
<!-- <img src=x onerror="document.body.dataset.xss='comment'"> -->
<![CDATA[<img src=x onerror="document.body.dataset.xss='cdata'">]]>

## 9. 表單、meta、base

<form action="javascript:alert(1)"><input type="submit" value="送出"></form>
<meta http-equiv="refresh" content="0;url=javascript:alert(1)">
<base href="javascript:alert(1)//">
<link rel="stylesheet" href="https://example.invalid/evil.css">
<template><img src=x onerror="document.body.dataset.xss='template'"></template>
<noscript><img src=x onerror="document.body.dataset.xss='noscript'"></noscript>

## 10. DOM clobbering：用 name／id 覆蓋頁面上的函式

<img name="getElementById" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==">
<img name="querySelector" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==">
<img name="createElement" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==">
<img name="documentElement" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==">
<a id="MarkLens">id=MarkLens</a>
<a id="chrome">id=chrome</a>
<a name="old-style-anchor">舊式錨點（應保留）</a>

## 11. 偽造 MarkLens 介面

<div class="ml-viewer open">假的全螢幕圖片檢視器</div>
<div class="ml-toast show">偽造提示：請輸入密碼</div>
<div class="ml-toolbar">假的工具列</div>
<div id="ml-root">假的 ml-root</div>
<ul><li class="ml-task-0000000000000000-3"><input type="checkbox"> 猜不到 nonce 的任務</li></ul>

## 12. 標題中的攻擊碼 <img src=x onerror="document.body.dataset.xss='heading'">

### <script>document.body.dataset.xss='h3-script'</script>第三層

#### <a href="javascript:document.body.dataset.xss='h4-link'">第四層</a>

## 13. Mermaid

```mermaid
flowchart TD
  A[點擊事件] --> B[外部連結]
  click A call alert()
  click B href "javascript:document.body.dataset.xss='mermaid-href'"
```

```mermaid
flowchart TD
  A["<a href='javascript:document.body.dataset.xss=1'>節點連結</a>"] --> B["<button onclick='document.body.dataset.xss=2'>節點按鈕</button>"]
  B --> C["<script>document.body.dataset.xss='mermaid-script'</script>"]
  C --> D["<img src=x onerror=document.body.dataset.xss='mermaid-img'>"]
  D --> E["<iframe src='javascript:document.body.dataset.xss=3'></iframe>"]
```

```mermaid
flowchart LR
  A[一] -->|"<img src=x onerror=document.body.dataset.xss='edge'>"| B[二]
  B -->|"<script>document.body.dataset.xss='edge-script'</script>"| C[三]
```

```mermaid
pie title "<img src=x onerror=document.body.dataset.xss='pie-title'>"
  "正常" : 50
  "<img src=x onerror=document.body.dataset.xss='pie-label'>" : 30
```

```mermaid
stateDiagram-v2
  [*] --> S1
  S1 --> S2: <img src=x onerror=document.body.dataset.xss='state'>
  S2 --> [*]
```

```mermaid
sequenceDiagram
  A->>B: <img src=x onerror=document.body.dataset.xss='sequence'>
  Note over A: <script>document.body.dataset.xss='seq-note'</script>
```

```mermaid
%%{init: {"securityLevel": "loose", "startOnLoad": true}}%%
flowchart TD
  A["<img src=x onerror=document.body.dataset.xss='init-loose'>"] --> B[嘗試以 init 指令改成 loose]
  click B call alert()
```

## 14. 自動連結比照 GitHub

自動連結：檔名 README.md、裸網域 example.com 不連結；www.example.com、https://example.com/a 與 a@example.com 連結。

## 結尾

本段應正常顯示。
