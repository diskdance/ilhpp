# 跨语言链接增强工具（ILH++ / Internal Link Helper++）
本小工具为中文维基百科的跨语言链接添加了弹出提示、外文页面预览功能，并且和 MediaWiki 的设计语言及页面预览弹框外观保持一致。

## FAQ
### 为什么预览不显示图片？
因为太复杂，不想做。

## 部署方法
本小工具兼容的最低 MediaWiki 版本为 1.42.0。仓库中含有两个包，`ilhpp` 包含了小工具除设置窗口外的所有代码；`ilhpp-settings` 包含了设置窗口的代码，并在需要时动态加载以优化性能。

小工具的定义位于各自包下的 `.gadgetdefinition` 文件内，先将其添加至 MediaWiki。然后使用 `build` 脚本构建两个包，生成的代码位于根目录的 `dist` 目录内，然后将其复制到 MediaWiki 命名空间下的同名位置（MediaWiki:Gadget-xxx.(css|js)）。

## 授权协议
本小工具依照 GPLv2 协议授权。
