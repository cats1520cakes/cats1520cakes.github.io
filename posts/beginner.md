下面是基于 Vite + Mantine 模板的项目从安装、开发到部署整个流程的详细总结：

---

### 1. 环境准备

- **安装 Node.js**  
  确保你已安装 Node.js（例如 v22.11.0），可通过 [Node.js 官网](https://nodejs.org/) 下载。

- **安装全局包管理工具 pnpm**  
  使用 npm 全局安装 pnpm：
  ```bash
  npm install -g pnpm
  ```

---

### 2. 克隆项目

- **克隆仓库**  
  直接克隆 mantinedev 提供的 Vite 模板仓库：
  ```bash
  git clone https://github.com/mantinedev/vite-template.git
  ```
- **进入项目目录**  
  ```bash
  cd vite-template
  ```
  
---

### 3. 更新与安装依赖

- **更新依赖**  
  进入项目后运行：
  ```bash
  pnpm update
  ```
  此步骤会确保所有依赖为最新版本。如果项目的 package.json 中声明使用 yarn，你需要先修改该文件中的 `"packageManager"` 字段，将其改为 `"pnpm@<版本>"`（例如 `"pnpm@8.6.3"`），以便统一使用 pnpm 进行依赖管理。

- **安装缺失的依赖**  
  根据构建或开发时出现的错误，补充安装对应模块（如 `vite-tsconfig-paths`、`react-router-dom` 等）：
  ```bash
  pnpm add -D vite-tsconfig-paths
  pnpm add react-router-dom
  ```

---

### 4. 开发阶段

- **启动开发服务器**  
  使用 Vite 进行开发预览：
  ```bash
  pnpm run dev
  ```
  如遇 “EACCES: permission denied” 错误，检查 Vite 配置文件（vite.config.js/mjs），将服务器监听地址改为 IPv4：
  ```js
  export default defineConfig({
    server: {
      host: '127.0.0.1',
      port: 5173,
    },
  });
  ```
  
- **调试与预览**  
  模板中通常还包含 Storybook（通过 `pnpm storybook` 启动）以及单元测试（例如 *.test.tsx 文件），你可以分别调试组件的展示和行为。

---

### 5. 构建项目

- **构建生产代码**  
  在开发无误后，运行下面的命令生成生产环境的静态文件：
  ```bash
  pnpm run build
  ```
  此命令会先通过 tsc 进行 TypeScript 编译，再由 Vite 使用 Rollup 构建项目，生成适合部署的代码。

---

### 6. 部署到 GitHub Pages

- **仓库配置**  
  确认你的远程仓库地址是你自己的 GitHub Pages 仓库（例如：https://github.com/cats1520cakes/cats1520cakes.github.io.git）。如果当前远程地址仍指向原始模板仓库，使用：
  ```bash
  git remote set-url origin https://github.com/cats1520cakes/cats1520cakes.github.io.git
  ```

- **提交代码**  
  确保本地有有效提交（必要时重命名分支为 main 或直接使用 master），例如：
  ```bash
  git add .
  git commit -m "Initial commit with Vite + Mantine template"
  ```
- **强制推送（如果需要完全覆盖远程仓库）**  
  使用 force 推送确保远程所有内容替换为当前上传的文件：
  ```bash
  git push --force origin main
  ```
  （注意：如果本地分支名称为 master，则改为 `git push --force origin master` 或先重命名分支）

---

### 7. 后续开发与更新

- **添加内容**  
  根据需要新增博客文章、推文等内容（例如使用 Markdown 文件放在 `public/posts` 中，再在 React 组件中使用 `react-markdown` 渲染）。

- **调整模板**  
  根据自己的风格要求，通过修改 Mantine 组件、主题和 CSS，达到更美观的效果。

- **扩展功能**  
  可集成路由（如使用 react-router-dom）、搜索功能（比如利用 fuse.js 进行本地搜索）以及大模型 API，实现更丰富的互动体验。

- **更新部署流程**  
  每次新增或修改内容后，重复构建发布步骤：
  1. 保存代码、提交变更。
  2. 运行 `pnpm run build` 重建生产代码。
  3. 通过 Git Push 更新 GitHub Pages 上的代码。

下面是基于上次总结内容的新的总结，重点解释我们遇到的问题以及解决步骤：

---

## 1. 问题描述

在开发使用 Vite+TypeScript（TSX）的项目时，浏览器在加载模块脚本时出现如下错误：

> **Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "application/octet-stream".**

这表示浏览器期望加载经过编译后的 JavaScript 模块，但实际请求的文件 MIME 类型不正确（返回的是 application/octet-stream），通常意味着服务器没有正确告知文件类型，导致浏览器拒绝执行该脚本。

---

## 2. 问题原因

主要有以下几种可能的原因：

1. **构建处理不当**  
   - 你的 TypeScript/TSX 文件没有被正确编译为 JavaScript 模块，或者编译后的输出文件没有被正确引用。  
   - 示例：构建时最终生成的文件在 `dist` 文件夹中，而 HTML 中错误地引用了 `/src/main.tsx` 源码，而非编译后的 `/dist/assets/index-xxxxx.js` 文件。

2. **HTML 引用方式错误**  
   - HTML 文件中直接使用 `<script type="module" src="/src/main.tsx"></script>` 导致浏览器直接请求 TSX 文件，而非经过构建转换后的 JS 模块。  
   - 浏览器无法直接执行 TypeScript，且服务器默认以二进制流（application/octet-stream）返回文件，所以触发错误。

3. **部署过程问题**  
   - 构建输出（dist 文件夹）未正确上传到 GitHub 仓库对应的分支，导致 GitHub Pages 没有正确的静态资源供浏览器加载。  
   - 如果直接提交源码而不是构建后的文件，浏览器在访问时就会请求源代码文件，从而出现 MIME 类型错误。

---

## 3. 解决方案与部署步骤

### (1) 正确构建和编译

- **使用 Vite 构建：**  
  确保使用正确的构建命令（例如：`pnpm run build`，其中命令为 `tsc && vite build`），这样会将 TypeScript/TSX 文件转换为浏览器能识别的 JavaScript 模块，并输出到 dist 文件夹中。  
  构建日志示例中可见生成了类似于 `dist/assets/index-gMXTc_ns.js` 的文件。

- **引用编译后的文件：**  
  部署时，HTML 中应引用 build 输出的文件，而非源码。通过 Vite 构建后的 index.html 中，脚本标签会被替换成类似：
  ```html
  <script type="module" src="/assets/index-gMXTc_ns.js"></script>
  ```
  这样浏览器才能正确加载并执行。

### (2) 将构建文件正确上传到 GitHub

上传 GitHub 的核心是要确保部署的是 dist 文件夹中的产出，而非源码。常用方式有两种：

#### 方法 A：使用 gh‑pages 自动部署

1. **安装 gh‑pages：**  
   在项目根目录中安装：
   ```bash
   pnpm add -D gh-pages
   ```
2. **配置 package.json：**  
   添加 deploy 脚本：
   ```json
   "scripts": {
     "build": "tsc && vite build",
     "deploy": "gh-pages -d dist"
   }
   ```
3. **执行构建和部署：**  
   先运行 `pnpm run build`，再运行 `pnpm run deploy`。此工具会将 dist 文件夹内容推送到 gh-pages 分支。
4. **GitHub Pages 设置：**  
   在 GitHub 仓库 Settings > Pages 中，将发布源设置为 gh-pages 分支（通常选择根目录）。

#### 方法 B：使用 Git subtree 手动部署

1. **先确保代码已提交并关联仓库。**
2. **构建项目：**  
   执行 `pnpm run build`。
3. **推送 dist 文件夹：**
   使用 Git 命令：
   ```bash
   git subtree push --prefix dist origin gh-pages
   ```
4. **在 GitHub Pages 设置中，将发布源设置为 gh-pages 分支。**

---

## 4. 小贴士

- **.nojekyll 文件：**  
  为防止 GitHub Pages 进行 Jekyll 预处理，可以在 dist 目录下添加一个空白的 `.nojekyll` 文件，确保所有文件按照原始结构发布。
- **反复部署：**  
  每次修改代码后，需要重新运行构建与部署命令以确保最新内容生效。

---

总结来说，我们遇到的问题是由于在开发时 HTML 引用了未编译的 TSX 文件，加上部署时未正确上传构建产物，导致浏览器收到错误的 MIME 类型（application/octet-stream），从而无法正确加载模块。通过正确构建、引用编译后的文件以及使用 gh-pages 或 git subtree 部署构建产物到 GitHub Pages，就能解决该问题。