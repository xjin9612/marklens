<!-- 商店截圖用的示範表格（scripts/store-screenshots.mjs） -->
# API 端點 — 10 月

| 端點 | 方法 | 服務 | 區域 | 每日請求數 | p50 | p95 | 錯誤率 | 資料量 | 上次部署 | 負責人 |
|---|---|---|---|---:|---:|---:|---:|---:|---|---|
| `/orders` | GET | order-api | ap-east-1 | 40,900 | 16 ms | 48 ms | 0.16% | 4MB | 2026-09-02 | 林雅婷 |
| `/orders` | POST | order-api | ap-northeast-1 | 13,000 | 65 ms | 195 ms | 0.11% | 15MB | 2026-10-02 | 王建宏 |
| `/orders/{id}` | GET | order-api | us-west-2 | 75,000 | 15 ms | 60 ms | 0.06% | 1.6KB | 2026-10-27 | 張怡君 |
| `/orders/{id}` | PATCH | order-api | eu-central-1 | 11,000 | 150 ms | 750 ms | 1.12% | 4MB | 2026-09-16 | 李志豪 |
| `/payments` | POST | payment-gateway | ap-east-1 | 2,277,000 | 123 ms | 1,107 ms | 0.07% | 384B | 2026-10-10 | 吳佩珊 |
| `/payments/{id}` | GET | payment-gateway | ap-northeast-1 | 35,600 | 118 ms | 708 ms | 0.12% | 320B | 2026-10-05 | 陳冠宇 |
| `/refunds` | POST | payment-gateway | us-west-2 | 4,500 | 23 ms | 161 ms | 0.34% | 6.4KB | 2026-08-27 | 黃詩涵 |
| `/inventory` | GET | inventory-sync | eu-central-1 | 49,000 | 174 ms | 522 ms | 0.18% | 37MB | 2026-10-10 | 劉家豪 |
| `/inventory/{sku}` | PUT | inventory-sync | ap-east-1 | 1,680,000 | 9 ms | 81 ms | 1.07% | 319B | 2026-10-05 | 林雅婷 |
| `/search` | GET | search-indexer | ap-northeast-1 | 1,114,000 | 131 ms | 393 ms | 0.17% | 3.6KB | 2026-10-09 | 王建宏 |
| `/users/{id}` | GET | account | us-west-2 | 37,200 | 101 ms | 505 ms | 0.03% | 354B | 2026-08-16 | 張怡君 |
| `/sessions` | POST | account | eu-central-1 | 846,000 | 5 ms | 20 ms | 0.42% | 824B | 2026-10-20 | 李志豪 |
| `/sessions` | DELETE | account | ap-east-1 | 47,200 | 147 ms | 1,176 ms | 0.4% | 6.2KB | 2026-08-07 | 吳佩珊 |
| `/reports/daily` | GET | report-export | ap-northeast-1 | 10,000 | 32 ms | 224 ms | 0.12% | 10MB | 2026-08-12 | 陳冠宇 |
| `/exports` | POST | report-export | us-west-2 | 80,000 | 161 ms | 1,288 ms | 0.15% | 7.8KB | 2026-08-04 | 黃詩涵 |
| `/notifications` | GET | notification | eu-central-1 | 2,008,000 | 83 ms | 249 ms | 0.43% | 31MB | 2026-09-17 | 劉家豪 |
| `/webhooks` | POST | notification | ap-east-1 | 940,000 | 41 ms | 82 ms | 0.76% | 1.2KB | 2026-10-12 | 林雅婷 |
| `/health` | GET | edge | ap-northeast-1 | 23,000 | 140 ms | 980 ms | 1.91% | 26MB | 2026-09-07 | 王建宏 |
| `/catalog` | GET | catalog | us-west-2 | 36,900 | 11 ms | 22 ms | 0.79% | 45MB | 2026-10-15 | 張怡君 |
| `/catalog/{sku}` | GET | catalog | eu-central-1 | 94,000 | 60 ms | 180 ms | 0.05% | 31MB | 2026-10-27 | 李志豪 |
| `/cart` | POST | cart | ap-east-1 | 2,063,000 | 168 ms | 504 ms | 0.17% | 597B | 2026-10-26 | 吳佩珊 |
| `/cart` | GET | cart | ap-northeast-1 | 9,300 | 105 ms | 945 ms | 0.08% | 362B | 2026-09-19 | 陳冠宇 |
| `/checkout` | POST | cart | us-west-2 | 63,100 | 125 ms | 875 ms | 0.47% | 1MB | 2026-08-17 | 黃詩涵 |
| `/shipping/rates` | GET | shipping | eu-central-1 | 97,000 | 58 ms | 116 ms | 0.25% | 3.1KB | 2026-10-18 | 劉家豪 |
