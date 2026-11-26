# WARMTH Theme Studio — 第三方來源與授權紀錄

查核日期：2026-11-26。此檔記錄研究來源，不代表這些專案已成為 WARMTH runtime dependency。

## VII-Cae/hyalite--liquid-glass

- 查核 commit：`b9f27192a7256bf5295bf027b582b86864f9b59d`。
- package 版本：0.5.0；最新 release/tag：`v0.5.0`，tag commit `3c7eb86d7457b437013c5e9579e9c2d6fe713f2d`。其後查核 commit 只補署名與分享文件，無引擎變更。
- 實際查核：`package.json`、`README.md`、`hyalite.js`、`hyalite.d.ts`、`LICENSE`。
- 技術路線：per-element rounded-rect SDF lens maps、SVG `feDisplacementMap`、backdrop refraction；無 WebGL。
- 授權：MIT，Copyright (c) 2026 VII-Cae (VII)。再利用須保留著作權與授權全文。
- 本次整合決策：只研究公開方法；WARMTH renderer 依使用者提供 Skill 的原創規格獨立實作，未複製 Hyalite 引擎或素材。

MIT License

Copyright (c) 2026 VII-Cae (VII)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## everett745/liquid-glass

- 查核 commit：`a3fc277f5701e5a718467e75b20be71030797c01`。
- package 版本：0.1.0；查核時無 Git tags，releases/latest 回 404。
- 實際查核：`package.json`、`README.md`、`src/LiquidGlassInstance.ts`、`src/core/shaders.ts`、`src/core/effects/webgl.ts`、`src/core/effects/svg.ts` 及根目錄。
- 技術路線：React/vanilla adapters、SVG/WebGL/CSS modes；WebGL 從呼叫者提供的 image/canvas 上傳 texture。查核版 shader 使用動態 wave/pointer distortion，不是 WARMTH 所需的完整 SDF 四角幾何實作。
- 授權：根目錄未見 LICENSE，`package.json` 亦未宣告 `license`。公開原始碼不構成再分發授權。
- 本次整合決策：不複製、不打包、不安裝、不列為依賴。

## Sui-IB/InternalBeyond-Mobile

僅作前期功能與架構構想參考。未複製其程式碼、素材、品牌或辨識性版面；其非商業授權不被視為商業整合許可。

## isjiamu/gzh-design-skill

僅依上傳 Skill 的設計方法摘要建立 WARMTH 原創 registry、recipe 與雙階段驗證；未自動 clone、install、execute 或引入上游。上傳 Skill 記錄其為 AGPL-3.0，實際引用任何程式前仍需另核指定 commit 與義務。
