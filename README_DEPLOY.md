# ai-dynamic-scaffold-simple 部署说明

这是一个最小可用版：

- 学生无需注册账号，只输入 `S00–S30` 编号和姓名。
- `S00` 为教师测试账号；正式导出默认排除 S00。
- 学生可上传 1 张图片并输入文字，图片会发送给扣子智能体识别。
- 支持连续多轮对话，刷新页面后可恢复服务器中保存的历史记录。
- 教师后台 `/admin.html` 用密码登录，可查看每个学生的完整文字对话和上传图片。
- 后台支持导出 JSON 与 CSV。
- Coze Token 只保存在服务端环境变量中，不会下发到学生浏览器。

## 1. 扣子侧准备

确保你的智能体已经“发布到 API”。准备：

- `COZE_ACCESS_TOKEN`
- `COZE_BOT_ID`

令牌需要覆盖本项目调用所需的权限：聊天、上传文件、查询对话状态、查看消息列表。

本项目使用：

- `POST https://api.coze.cn/v1/files/upload`
- `POST https://api.coze.cn/v3/chat`
- `GET https://api.coze.cn/v3/chat/retrieve`
- `GET https://api.coze.cn/v3/chat/message/list`

## 2. 腾讯云 EdgeOne Makers 部署

建议继续用你之前的方式：GitHub -> EdgeOne Makers。

1. 把 ZIP 解压后上传到一个 GitHub 仓库根目录。
2. EdgeOne Makers 新建项目并连接该 GitHub 仓库。
3. 项目按“静态站点 + Cloud Functions”部署即可，前端无需构建。
4. 在项目环境变量中添加：

```text
COZE_ACCESS_TOKEN=你的扣子个人访问令牌
COZE_BOT_ID=你的智能体ID
ADMIN_PASSWORD=教师后台密码
DATA_STORE_NAME=ai-dynamic-scaffold-data
EXPERIMENT_RUN_ID=2026-fall
```

其中前三项必填，后两项可不填。

`@edgeone/pages-blob` 会在 Makers Functions 中自动使用 Blob 存储，第一次请求时会创建对应 Store，无需再手动建数据库。

## 3. 访问地址

部署成功后：

- 学生端：`https://你的域名/`
- 教师后台：`https://你的域名/admin.html`

首页右上角也有“进入教师后台”。

## 4. 学生使用

1. 输入编号：`S01`–`S30`；教师测试用 `S00`。
2. 输入姓名。
3. 进入后，可只发文字，也可上传图片后一起发送。
4. 同一编号第一次保存姓名后，后续如果姓名不一致会提示检查，避免学生误输编号。
5. 图片最大 10 MB，仅允许常见图片格式。

## 5. 教师后台

输入 `ADMIN_PASSWORD` 登录后，可以：

- 查看学生编号、姓名、是否测试账号；
- 查看消息数、最近活动时间；
- 打开学生详情查看完整聊天；
- 查看学生上传的原图；
- 导出正式 JSON / CSV（默认排除 S00）；
- 导出全部 JSON（含 S00）。

## 6. 数据结构

Blob Store 内大致如下：

```text
runs/{EXPERIMENT_RUN_ID}/students/S01/profile.json
runs/{EXPERIMENT_RUN_ID}/students/S01/messages/<timestamp>-<uuid>.json
runs/{EXPERIMENT_RUN_ID}/students/S01/images/<uuid>.bin
runs/{EXPERIMENT_RUN_ID}/students/S01/images/<uuid>.json
runs/{EXPERIMENT_RUN_ID}/admin-sessions/<token>.json
```

聊天数据包含：学生编号、姓名、角色、文字、是否带图、图片 ID、时间、Coze conversation_id/chat_id。

## 7. 常见问题

### 学生发消息后一直转圈

先检查：

- Bot 是否已发布到 API；
- `COZE_ACCESS_TOKEN` 是否有效；
- Token 是否有聊天、上传文件、读取对话/消息权限；
- `COZE_BOT_ID` 是否填的是 Bot ID；
- 扣子额度是否可用。

### 图片上传成功但智能体看不到图

本项目会先把图片上传到扣子拿到 `file_id`，再通过 `object_string` 图文消息发送给 Bot。若仍看不到，请检查 Bot 所用模型是否支持视觉输入。

### 修改智能体人设后要改网站吗？

只要 Bot ID 不变、重新发布到 API，网站代码不用改。


## 首页管理员入口

首页封面提供“管理员进入”按钮，点击后输入密码，验证成功会直接进入后台。
