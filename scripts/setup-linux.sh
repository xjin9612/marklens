#!/usr/bin/env sh
# Linux／WSL 開發環境：安裝跑測試、版面檢查與驗證列印所需的瀏覽器、字型與工具
# 用法：sh scripts/setup-linux.sh（需要 sudo；重複執行無妨）
#
#   Playwright Chromium 與系統套件  npm test、npm run test:visual、npm run audit:layout、截圖腳本
#   fonts-noto-cjk                  中日韓字型：框線字元對齊測試與視覺基準圖需要（與 CI 相同）
#   poppler-utils                   pdftoppm／pdftotext：把 page.pdf() 的輸出轉成圖片或文字，檢查列印結果
#   ffmpeg                          把錄影畫格轉成 README 的 GIF（npm run gifs）
#
# Chromium 的沙箱：Ubuntu 23.10 起以 AppArmor 限制一般使用者建立命名空間，Playwright 可能提示放寬系統設定。
# 不需要照做：Playwright 在 Linux 預設不使用 Chromium 沙箱（CI 也是），測試只開啟 repo 內的檔案與本機伺服器
set -eu
cd "$(dirname "$0")/.."

npm ci
npx playwright install --with-deps chromium
sudo apt-get install -y --no-install-recommends fonts-noto-cjk poppler-utils ffmpeg

echo "完成。可執行 npm test 確認"
