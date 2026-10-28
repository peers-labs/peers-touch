# QR Parameter Reference — Disposition

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-10-27 | **Updated**: 2026-10-27
> **Owner**: Identity and Access / Schema

本需求参考微信参数设计，不追求微信扫码登录协议或私有码制兼容。
仅使用官方API事实，未推断其内部认证状态机。

[微信getUnlimitedQRCode](https://developers.weixin.qq.com/minigame/dev/api-backend/qr-code/api_getunlimitedqrcode.html)
在2026-10-27查阅：

- `scene`：最多32个可见字符；`page`独立，不带query。**adapt**为typed业务
  payload与链接目标分离；不照搬32字符上限，因为我们的安全连接材料不同。
- `width`：默认430，280—1280px。**adapt**为组件尺寸参数与模块密度计算；
  不把微信像素范围当成我们真机扫码证明。
- `auto_color/line_color`：自动色与RGB定色。**adopt/adapt**为`auto|token|explicit`
  颜色策略与不可绕过的实际对比度验证。
- `is_hyaline`：透明底色。**adapt**为可验证的已知背景；
  登录码默认不透明亮底，未知背景拒绝透明输出。
- `check_path/env_version`：小程序页面与release/trial/develop。**reject**通用
  绘码器拥有部署环境；业务与链接owner校验目标，QRrenderer不决定运行环境。
- 返回图像buffer，失败返回错误。**adopt**结构化成功/错误和SVG/PNG输出。
- 此接口未列出自定义头像参数。头像注入是Peers自己的能力，不能归因微信接口。
- 永久有效小程序码。**reject**用作登录授权期限；登录码必须短时、可取消。

[qrcode.react官方README](https://github.com/zpao/qrcode.react)说明现有组件支持
SVG/Canvas、ECC、4-module margin和imageSettings；可复用知识，但现有组件
尚未提供统一链接/安全/Peers风格合同。

[QR Code Styling官方README](https://github.com/kozakdenys/qr-code-styling)
支持SVG/Canvas、图像、dots/corner样式，底层使用qrcode-generator，MIT许可。
**adapt**为单一绘码引擎，API不直接泄露给页面；生产版本待依赖/decoder证据锁定。

[DENSO官方quiet-zone说明](https://www.qrcode.com/en/howto/code.html)
要求四边4个模块。**adopt**不可被主题或头像改变的quiet zone。
高纠错不是任意遮挡的许可证；可扫描性需要独立decoder及真机验证。
