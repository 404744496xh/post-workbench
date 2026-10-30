# 写作台 (post-workbench)

Halo 2.26 控制台插件。为文章管理提供一个笔记软件式的工作台视图：左侧多级分类树 + 文章标题列表，右侧内嵌原生文章编辑器，不跳页即可完成浏览、编辑、发布、移动分类等操作。同时提供一个 Typora 风格的 Markdown 编辑器，可按文章切换富文本 / Markdown。

入口：控制台左侧菜单「内容 → 写作台」，路由 `/console/workbench`，支持深链 `?name=<postName>`。

## 功能

- **多级分类树**：按分类层级缩进展示，文章挂在所属分类下；未分类文章单独归组。支持搜索（标题 + 摘要，客户端即时过滤）、状态筛选（全部/已发布/草稿/定时）与数量统计。
- **标题列表**：行内只显示标题、状态点、相对时间与置顶标记；鼠标悬停约 0.3s 才弹出摘要卡片，避免列表噪音。
- **内嵌编辑器**：右侧直接加载 Halo 原生文章编辑器（同源 iframe），隐藏原生侧栏/页脚；顶部标题、保存、发布、设置等全部沿用原生逻辑。
- **折叠大纲面板**：「大纲/详情」面板左缘中部有低调箭头，可收起面板让正文占满；收起后右缘保留一条细栏（标题刻度），悬停显示标题列表、点击平滑跳转；偏好本地记忆，切换文章与刷新后保持。
- **右键菜单**：打开、新标签打开、预览、复制链接、发布/取消发布、置顶、移动分类、用 Markdown / 富文本编辑、文章设置、删除（进回收站）。
- **Markdown 编辑器**：注册为 Halo 编辑器提供方（`rawType: markdown`），基于 Vditor「即时渲染」（IR）模式，隐藏工具栏，正文居中 800px 栏宽、大标题输入框，贴近 Typora 的所见即所得体验；支持标题、列表、引用、表格、代码块（高亮）、图片粘贴/拖拽上传、深色模式；右侧内置「大纲」面板，随输入更新、点击平滑跳转到对应标题；保存沿用原生 `Ctrl/⌘ + S` 与顶部保存按钮。
- **打开即校正渲染结果**：Markdown 编辑器挂载后会用当前源码重新生成 HTML 并回写，因此历史上被格式转换插件留下「源码是 Markdown、站点端却渲染旧 HTML」的文章，只要在 Markdown 编辑器里打开并保存一次，前台即恢复正常排版。
- **富文本 ⇄ Markdown**：右键菜单按当前格式显示「用 Markdown 编辑」或「切换到富文本编辑器」，确认后自动转换正文并写回 `content.halo.run/preferred-editor` 注解；富文本转 Markdown 保留标题、加粗、斜体、链接、列表、引用、代码块、表格、图片（含图注）与音视频/iframe 原始标签，颜色、对齐、画廊排版等纯富文本样式会丢失。
- **新建文章**：可指定分类创建，创建后自动补写分类并出现在树中。
- **布局**：树宽可拖拽（220–560px，本地记忆，双击复位）；窗口宽度小于 1000px 时自动收起树，通过左侧细栏一键展开。
- **隐藏控制台导航**：控制台侧栏右缘垂直中部有一个低调的「‹」箭头，点击隐藏导航让工作台占满全宽；隐藏后工作台左缘中部出现「›」箭头可恢复。偏好本地记忆，离开写作台自动恢复导航。
- **拖拽移动分类**：把文章行拖到任意分类即可更换分类，拖到「未分类」则清空分类；松手后自动刷新并提示。
- **筛选剪枝**：按已发布 / 草稿 / 定时筛选时，没有匹配文章的分类（含空的父级与「未分类」）自动隐藏。
- **覆盖文章页（插件设置）**：开启后访问「文章」页面会直接进入写作台；写作台头部出现「打开原文章视图」按钮，原生文章页右下角出现「写作台视图」悬浮按钮，可随时来回切换。
- **同步**：切换文章时静默刷新列表（标题改名即时反映）；页面可见时每 60s 轮询 + 窗口聚焦刷新；发布跳转后自动恢复工作台。

## 插件设置

控制台 → 插件 → 写作台 → 「基础设置」：

- **覆盖文章页**：默认关闭。开启后访问 Halo 原生「文章」页面会直接进入写作台，侧栏中的「写作台」独立入口会隐藏；写作台头部出现「打开原文章视图」按钮，原生文章页右下角出现「写作台视图」悬浮按钮，两者可互相切换。关闭后原生文章页与「写作台」入口都恢复。

## 构建

需要 JDK 21 与 Node 20+。

```bash
cd plugins/post-workbench
./gradlew build          # 产物: build/libs/post-workbench-<version>.jar
```

仅构建前端时可 `cd ui && npm install && npm run build`。

## 安装

Halo 控制台 → 插件 → 安装，上传 jar，安装后手动启用。

本地升级注意：Windows 下正在运行的 Halo 会锁住已加载的 jar，升级前需提升版本号（`build.gradle` 中 `version`）再构建上传。

## 实现说明与注意事项

- **不改造原生页面**：Halo 2.26 的扩展点无法替换文章页，因此采用「新增路由 + 同源 iframe 嵌入原生编辑器」的方案。原生编辑器能力（保存、发布、设置、AI 等）随 Halo 升级自动获得。
- **iframe 清理**：向 iframe 注入样式隐藏 `.layout > aside.sidebar`、页脚与移动端底部导航，并重置 `.main-content` 尺寸；这些选择器依赖 Halo 控制台 DOM，升级大版本后需回归检查。
- **切换文章**：原生编辑器只在挂载时读取 `?name=`，仅改 query 不会重载。切换时通过 iframe 内 Vue Router（`#app.__vue_app__`）先跳到占位路由再 replace 到目标地址，强制重新挂载；失败时回退为整页刷新。
- **接口**：列表用 `consoleApiClient.content.post.listPosts` 分页并发获取（每页 100，按创建时间倒序，过滤回收站）；分类用 `listCategoryTree`（层级字段为 `spec.parent`）；发布/取消发布为 `PUT .../publish|unpublish`；置顶/移动分类通过 JSON Patch 修改 `spec.pinned` / `spec.categories`。
- **Markdown 编辑器注册**：通过 `extensionPoints["editor:create"]` 注册 `halo-markdown-typora` 提供方，Halo 原生编辑器页会出现在编辑器下拉中。Vditor 运行时（lute / i18n / 图标 / KaTeX / highlight.js）随插件静态资源打包，`cdn` 指向 `/plugins/post-workbench/assets/ui/vditor`，不依赖外部 CDN。
- **编辑器切换**：`switchPostEditor` 读取 head 内容后转换，调用 `updatePostContent` 写回 raw / content / rawType，并 PATCH `metadata.annotations.content.halo.run~1preferred-editor`。Halo 更新已有快照时不会改 `spec.rawType`，因此额外 PATCH head 快照的 `spec.rawType`，保证元数据一致。
- **转换细节**：HTML → Markdown 使用 turndown + GFM 插件；针对 Halo 富文本的 `<li>/<td>/<th>` 内嵌 `<p>`、`halo-table-wrapper`、`figure[data-content-type=image]` 图注等结构做了专门规则；Markdown → HTML 使用 marked（GFM）。
- **性能**：251 篇文章实测首屏约 0.95s（本地），再次进入约 0.4s，切换文章约 0.4s；列表行使用 `content-visibility: auto`，搜索为纯客户端过滤。
