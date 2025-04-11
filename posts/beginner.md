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

