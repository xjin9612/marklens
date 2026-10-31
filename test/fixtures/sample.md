---
title: MarkLens 測試文件
tags: [markdown, test]
---

# MarkLens 功能測試

這是一段中文段落，用來確認 UTF-8 解碼正確。==螢光標記==、**粗體**、~~刪除線~~、`inline code`、自動連結 https://example.com。

> [!NOTE]
> 這是 Note 提示框。

> [!WARNING]
> 這是 Warning 提示框。

## 任務清單

- [x] 已完成項目
- [ ] 未完成項目
- 一般項目

## 寬表格

| 名稱 | 數量 | 大小 | 日期 | 說明 |
|---|---:|---:|---|---|
| 蘋果 | 1,200 | 10KB | 2026-03-01 | 這是一段非常長的說明文字，用來測試表格在寬度不足時的換行行為，以及拖拉欄寬之後是否仍然可讀 |
| Banana | 30 | 2MB | 2025-12-24 | short |
| 櫻桃 | 450 | 512B | 2026-01-15 | 中等長度的說明 |
| Date | | 1GB | 2024-07-04 | 數量為空 |
| Elder | 75 | 3KB | 2025-06-30 | 第五列，讓篩選框出現 |

| 小表格 | 值 |
|---|---|
| a | 1 |

## 程式碼

```js
// 註解
function hello(name) {
  return `Hello, ${name}!`
}
```

```
沒有語言標記的區塊
```

## 很多欄的表格

| 欄位一 | 欄位二 | 欄位三 | 欄位四 | 欄位五 | 欄位六 | 欄位七 | 欄位八 |
|---|---|---|---|---|---|---|---|
| order_card_batch | getOrderCardList | assembleOrderResponse | getListByStatus | getOrderPage | lastUpdateTime DESC | IN_CHUNK_SIZE 128 | feature/jin/release_0814 |

## 腳註

這句話有腳註[^1]。

[^1]: 這是腳註內容。

## 安全性

<img src="x" onerror="document.body.dataset.xss='1'">
<a href="javascript:document.body.dataset.xss='2'">惡意連結</a>
<script>document.body.dataset.xss='3'</script>
<p style="position:fixed;inset:0">style 屬性應被移除</p>
<a href=" jav&#x09;ascript:alert(1)">編碼繞過</a>
<details><summary>允許的 HTML</summary>內容 <kbd>Ctrl</kbd>+<kbd>C</kbd></details>

### 第三層標題

文字。

## 鬆散任務清單

- Modify: `a.java`

- [ ] **Step 1**：鬆散清單（項目間有空行）的任務

  縮排的說明段落

## 重複標題

## 重複標題

結尾。
