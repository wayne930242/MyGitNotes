# Self-hosting architecture image edits

## Final correction: native Redis with Compose

Edit the supplied English MyGitNotes architecture diagram. Preserve its logo, entire layout, all arrows, local section, GitHub/GitLab repository, Vercel alternative, browser card, colors and ownership strip. Correct only the storage area inside the Docker / Compose card: replace the blue disk icon with a Redis icon, label it "Self-hosted Redis", then a smaller line "Persistent volume", then "Sessions + MCP grants". The Vercel card keeps its Redis icon, but its label becomes "Redis REST" and the line "Sessions + MCP grants" remains. This accurately shows that Docker Compose starts its own Redis service with persistent storage. Keep every other label unchanged. Make the two storage options visually balanced with legible English text.

Edit the supplied Traditional Chinese MyGitNotes architecture diagram. Preserve the logo, entire layout, all arrows, local section, GitHub/GitLab repository, Vercel alternative, browser card, colors and ownership strip. Correct only storage inside the Docker / Compose card: replace the blue disk icon with a Redis icon, label it "自架 Redis", then a smaller line "持久化磁碟", then "Session 與 MCP 授權". The Vercel card keeps its Redis icon, but its label becomes "Redis REST" and "Session 與 MCP 授權" remains. This shows Docker Compose starts its own Redis service with persistent storage. Keep all other labels unchanged. Use Traditional Chinese glyphs, balanced spacing and legible typography.

Generated with the built-in imagegen edit tool. The original MyGitNotes diagrams supplied the visual identity. The final English edit supplied the layout for its Traditional Chinese counterpart.

## English prompt

Use case: infographic-diagram edit.
Edit target: the supplied English MyGitNotes architecture diagram.
Preserve the MyGitNotes book logo and title, green local section, purple remote section, white background, clean rounded cards, icon style, and bottom YOU CONTROL ownership strip.
Update the diagram to accurately show deployment choice. In the remote section replace the single Vercel card with a clearly grouped pair of alternative hosts labeled "Docker / Compose" with a container/server icon and "Vercel" with its triangle, joined by the word "or". Both alternatives serve "Browser + MCP" and connect to the same "GitHub or GitLab" repository card. Add readable storage labels beneath each host: Docker / Compose uses "Persistent volume" for "Sessions + MCP grants"; Vercel uses "Redis" for "Sessions + MCP grants". Notes remain in GitHub / GitLab, with bidirectional "Sync" to local "Markdown + Git".
Keep local flow Browser -> Local API -> Markdown + Git and Agent CLI / IDE -> Markdown + Git with "Direct file access". Add the small subtitle "Node.js or Docker" to Local API. GitLab repository subtitle remains "GitLab.com or self-managed".
Expand canvas or rebalance layout to keep all labels and arrows spacious and legible. Use English labels throughout. Produce one polished landscape README diagram.

## Traditional Chinese localization prompt

Use case: text-localization edit.
Input image 1 is the edit target: the updated English MyGitNotes architecture with Docker / Compose and Vercel deployment choice. Input image 2 is a typography and terminology reference: the original Traditional Chinese diagram.
Create the Traditional Chinese counterpart of input 1. Preserve its exact logo, layout, icons, colors, arrows, both deployment options, and visual hierarchy. Replace English labels with Traditional Chinese as follows: LOCAL = 本地; REMOTE = 遠端; Browser = 瀏覽器; Local API = 本地 API; Node.js or Docker = Node.js 或 Docker; Agent CLI / IDE = 本地 Agent CLI / IDE; Direct file access = 直接編輯檔案; Sync = 同步; or = 或; GitLab.com or self-managed = GitLab.com 或自架 GitLab; (Notes repository) = （筆記儲存庫）; DEPLOYMENT CHOICE = 部署選擇; Persistent volume = 持久化磁碟; Sessions + MCP grants = Session 與 MCP 授權; Browser + MCP = 瀏覽器 + MCP; YOU CONTROL = 由你掌控; Files • Repository • Deployment • Commits • Agent Access = 檔案 • 儲存庫 • 部署 • 版本 • Agent 權限.
Keep MyGitNotes, Markdown + Git, GitHub, GitLab, Docker / Compose, Vercel, and Redis unchanged. Use exclusively Traditional Chinese glyphs for translated labels. Fit labels legibly within spacious cards.
